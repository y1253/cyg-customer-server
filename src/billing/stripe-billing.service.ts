import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  type OnApplicationBootstrap,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Prisma,
  type BillingTransaction,
  type CustomerSubscription,
} from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import {
  freeUntilAfter,
  statusFromStripe,
} from './entitlement.util';
import {
  chargeTransaction,
  invoiceTransaction,
  periodOfSubscription,
  subscriptionIdOfInvoice,
  trimmed,
  type InvoiceOutcome,
  type TransactionFields,
} from './invoice.util';
import { normalizeCode, promoProblem } from './pricing.util';
import { StripeClient } from './stripe.client';
import { SubscriptionService, type AccessState } from './subscription.service';

export interface PlanPrice {
  priceCents: number;
  currency: string;
  interval: string;
}

export interface BillingTransactionView {
  id: number;
  kind: BillingTransaction['kind'];
  status: BillingTransaction['status'];
  amountCents: number;
  currency: string;
  failureMessage: string | null;
  declineCode: string | null;
  nextRetryAt: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  receiptUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  promoCode: string | null;
  occurredAt: string;
}

export interface SubscriptionView {
  access: AccessState;
  price: PlanPrice | null;
  status: CustomerSubscription['status'];
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  freeUntil: string | null;
  freeForever: boolean;
  failedSince: string | null;
  lastFailureMessage: string | null;
  /** The card of the last payment (brand + last 4, never the number). */
  card: { brand: string; last4: string } | null;
  hasStripeCustomer: boolean;
  transactions: BillingTransactionView[];
}

/** Statuses after which Stripe never bills the subscription again. */
const FINISHED = ['canceled', 'incomplete_expired'];
const SYNC_EVERY_MS = 6 * 3_600_000;
const PRICE_CACHE_MS = 3_600_000;

/**
 * 2026-11-25: the Stripe half of the subscription. Stripe Checkout (hosted) starts it, the
 * Billing Portal manages it (card, cancel, invoices), and Stripe's webhooks + an hourly
 * sync keep `CustomerSubscription` and `BillingTransaction` true:
 *
 * - `syncSubscription` is the ONE writer of the Stripe-derived columns, always from a fresh
 *   `subscriptions.retrieve` — so events arriving out of order can never leave a stale
 *   status behind.
 * - every invoice outcome (paid / failed attempt / needs 3-D Secure), refund and dispute is
 *   one `BillingTransaction`, written once (`recordKey` unique, P2002 = already there).
 * - the hourly `syncAll` re-reads subscriptions not synced for 6 h (or past their period
 *   end) and their last 40 days of invoices — a missed webhook still lands, exactly once.
 */
@Injectable()
export class StripeBillingService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(StripeBillingService.name);
  private priceCache: { at: number; price: PlanPrice } | null = null;
  private syncing = false;
  private ensuring = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly stripeClient: StripeClient,
    private readonly subs: SubscriptionService,
  ) {}

  onModuleInit(): void {
    this.subs.priceText = async () => {
      const p = await this.price();
      return p ? money(p.priceCents, p.currency) : '$19.99';
    };
    if (this.stripeClient.configured && !this.stripeClient.webhookSecret)
      this.logger.error(
        'STRIPE_WEBHOOK_SECRET is not set — subscription changes and failed payments arrive only through the hourly sync',
      );
    if (this.stripeClient.configured && !this.stripeClient.priceId)
      this.logger.error(
        'STRIPE_SUBSCRIPTION_PRICE_ID is not set — customers cannot subscribe',
      );
  }

  /** Every account gets its Stripe Customer — the first sweep two minutes after start. */
  onApplicationBootstrap(): void {
    if (!this.stripeClient.configured) return;
    setTimeout(() => void this.ensureAllStripeCustomers(), 120_000).unref();
  }

  /** The plan's price, from Stripe (cached 1 h). Null when Stripe is not set up. */
  async price(): Promise<PlanPrice | null> {
    if (this.priceCache && Date.now() - this.priceCache.at < PRICE_CACHE_MS)
      return this.priceCache.price;
    const id = this.stripeClient.priceId;
    if (!this.stripeClient.configured || !id) return null;
    try {
      const p = await this.stripeClient.stripe.prices.retrieve(id);
      const price: PlanPrice = {
        priceCents: p.unit_amount ?? 0,
        currency: p.currency,
        interval: p.recurring?.interval ?? 'month',
      };
      this.priceCache = { at: Date.now(), price };
      return price;
    } catch (err) {
      this.logger.warn(
        `price ${id} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.priceCache?.price ?? null;
    }
  }

  async view(customerId: number): Promise<SubscriptionView> {
    const [access, sub, price, rows, customer] = await Promise.all([
      this.subs.state(customerId),
      this.subs.row(customerId),
      this.price(),
      this.prisma.billingTransaction.findMany({
        where: { customerId },
        orderBy: { occurredAt: 'desc' },
        take: 24,
      }),
      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { stripeCustomerId: true },
      }),
    ]);
    const withCard = rows.find((r) => r.cardLast4);
    return {
      access,
      price,
      status: sub.status,
      currentPeriodEnd: iso(sub.currentPeriodEnd),
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      freeUntil: iso(sub.freeUntil),
      freeForever: sub.freeForever,
      failedSince: iso(sub.failedSince),
      lastFailureMessage: sub.lastFailureMessage,
      card: withCard
        ? { brand: withCard.cardBrand ?? 'card', last4: withCard.cardLast4! }
        : null,
      hasStripeCustomer: !!customer?.stripeCustomerId,
      transactions: rows.map(transactionView),
    };
  }

  /** A Stripe Checkout page for the monthly plan. 409 while a paid plan is already on. */
  async startCheckout(customerId: number): Promise<{ url: string }> {
    const priceId = this.stripeClient.priceId;
    if (!priceId)
      throw new ServiceUnavailableException(
        'Subscriptions are not set up yet — please contact us.',
      );
    const sub = await this.subs.row(customerId);
    if (['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(sub.status))
      throw new ConflictException(
        'Your plan is already active — manage it from Billing.',
      );
    const stripeCustomerId = await this.ensureStripeCustomer(customerId);
    const base = this.subs.baseUrl();
    const session = await this.stripeClient.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(customerId),
      subscription_data: { metadata: { customerId: String(customerId) } },
      metadata: { customerId: String(customerId), purpose: 'subscription' },
      allow_promotion_codes: false,
      success_url: `${base}/dashboard/subscribe?done=1`,
      cancel_url: `${base}/dashboard/subscribe`,
    });
    if (!session.url)
      throw new ServiceUnavailableException('Stripe did not return a page.');
    this.logger.log(`checkout ${session.id} opened for customer ${customerId}`);
    return { url: session.url };
  }

  /** The Stripe Billing Portal (update card, cancel, invoices). */
  async portal(customerId: number): Promise<{ url: string }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { stripeCustomerId: true },
    });
    if (!customer?.stripeCustomerId)
      throw new NotFoundException('You have no billing account yet — subscribe first.');
    const session = await this.stripeClient.stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: `${this.subs.baseUrl()}/dashboard/account`,
    });
    return { url: session.url };
  }

  /**
   * A FREE_SUBSCRIPTION promo code: N months (or forever) free, no card. Refused while a
   * paid plan runs (they would pay AND be free). Counted with a conditional increment, so
   * two customers racing for the last use cannot both win.
   */
  async redeemPromo(
    customerId: number,
    code: string,
  ): Promise<{ freeUntil: string | null; freeForever: boolean }> {
    const promo = await this.prisma.promoCode.findUnique({
      where: { code: normalizeCode(code) },
    });
    const problem =
      promo && promo.kind !== 'FREE_SUBSCRIPTION'
        ? 'That promo code is not valid.'
        : promoProblem(promo);
    if (problem) throw new BadRequestException(problem);
    const sub = await this.subs.row(customerId);
    if (['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(sub.status))
      throw new ConflictException(
        'Your paid plan is active — cancel it first (Manage billing), or contact us.',
      );
    if (sub.freeForever)
      throw new ConflictException('Your account is already free.');
    const used = await this.prisma.billingTransaction.findFirst({
      where: { customerId, promoCodeId: promo!.id },
      select: { id: true },
    });
    if (used) throw new ConflictException('You already used that promo code.');

    const freeForever = promo!.freeMonths === null;
    const freeUntil = freeForever
      ? null
      : freeUntilAfter(sub.freeUntil, promo!.freeMonths!);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.promoCode.updateMany({
        where: {
          id: promo!.id,
          ...(promo!.maxUses !== null && { usedCount: { lt: promo!.maxUses } }),
        },
        data: { usedCount: { increment: 1 } },
      });
      if (!count)
        throw new BadRequestException('That promo code has been fully used.');
      await tx.customerSubscription.update({
        where: { customerId },
        data: freeForever
          ? { freeForever: true, freePromoCodeId: promo!.id }
          : { freeUntil, freePromoCodeId: promo!.id },
      });
      await tx.billingTransaction.create({
        data: {
          customerId,
          subscriptionId: sub.id,
          recordKey: `promo:${promo!.id}:${customerId}`,
          kind: 'FREE_PROMO',
          status: 'FREE',
          amountCents: 0,
          promoCodeId: promo!.id,
          promoCode: promo!.code,
          periodStart: new Date(),
          periodEnd: freeUntil,
          occurredAt: new Date(),
        },
      });
    });
    this.subs.forget(customerId);
    this.logger.log(
      `customer ${customerId} redeemed ${promo!.code}: ${freeForever ? 'free forever' : `free until ${freeUntil!.toISOString()}`}`,
    );
    return { freeUntil: iso(freeUntil), freeForever };
  }

  // ── Webhook ────────────────────────────────────────────────────────────────

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const secret = this.stripeClient.webhookSecret;
    if (!secret) throw new NotFoundException();
    let event: Stripe.Event;
    try {
      event = this.stripeClient.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        secret,
      );
    } catch {
      throw new BadRequestException('Invalid signature');
    }
    const when = new Date(event.created * 1000);
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.mode === 'subscription' && s.subscription) {
          await this.syncSubscription(idOf(s.subscription)!);
          await this.saveDefaultCard(idOf(s.subscription)!);
        }
        return;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        await this.syncSubscription(event.data.object.id);
        return;
      case 'invoice.paid':
        await this.onInvoice(event.data.object.id, 'paid', when, event.id);
        return;
      case 'invoice.payment_failed':
        await this.onInvoice(event.data.object.id, 'failed', when, event.id);
        return;
      case 'invoice.payment_action_required':
        await this.onInvoice(
          event.data.object.id,
          'action_required',
          when,
          event.id,
        );
        return;
      case 'charge.refunded':
        await this.onRefund(event.data.object, when, event.id);
        return;
      case 'charge.dispute.created':
        await this.onDispute(event.data.object, when, event.id);
        return;
      default:
        return;
    }
  }

  /**
   * Re-reads the subscription from Stripe and writes our row. The customer is found by
   * `metadata.customerId`, else by the Stripe Customer.
   */
  async syncSubscription(subscriptionId: string): Promise<void> {
    const sub = await this.stripeClient.stripe.subscriptions.retrieve(
      subscriptionId,
    );
    const customerId = await this.customerOf(
      sub.metadata?.customerId,
      idOf(sub.customer),
    );
    if (!customerId) {
      this.logger.warn(`subscription ${sub.id}: no customer of ours`);
      return;
    }
    const row = await this.subs.row(customerId);
    // A finished subscription never replaces a live one (a customer who re-subscribed).
    if (
      row.stripeSubscriptionId &&
      row.stripeSubscriptionId !== sub.id &&
      FINISHED.includes(sub.status) &&
      !['CANCELED', 'INCOMPLETE_EXPIRED', 'NONE'].includes(row.status)
    )
      return;
    const status = statusFromStripe(sub.status);
    const { start, end } = periodOfSubscription(sub);
    const item = sub.items?.data?.[0];
    await this.prisma.customerSubscription.update({
      where: { customerId },
      data: {
        stripeSubscriptionId: sub.id,
        stripePriceId: item?.price?.id ?? null,
        status,
        amountCents: item?.price?.unit_amount ?? null,
        currency: item?.price?.currency ?? null,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        canceledAt: at(sub.canceled_at),
        endedAt: at(sub.ended_at),
        ...(status === 'ACTIVE' && { everPaid: true }),
        syncedAt: new Date(),
      },
    });
    if (row.status !== status)
      this.logger.log(
        `customer ${customerId} subscription ${sub.id}: ${row.status} → ${status}`,
      );
    this.subs.forget(customerId);
  }

  private async onInvoice(
    invoiceId: string,
    outcome: InvoiceOutcome,
    when: Date,
    eventId: string | null,
  ): Promise<void> {
    const inv = await this.stripeClient.stripe.invoices.retrieve(invoiceId, {
      expand: [
        'payments.data.payment.payment_intent.latest_charge',
        'payments.data.payment.payment_intent.payment_method',
      ],
    });
    const subId = subscriptionIdOfInvoice(inv);
    if (!subId) return; // not a subscription invoice
    await this.syncSubscription(subId);
    await this.recordInvoice(inv, outcome, when, eventId);
  }

  private async recordInvoice(
    inv: Stripe.Invoice,
    outcome: InvoiceOutcome,
    when: Date,
    eventId: string | null,
  ): Promise<void> {
    const customerId = await this.customerOf(
      inv.parent?.subscription_details?.metadata?.customerId,
      idOf(inv.customer),
    );
    if (!customerId) return;
    const fields = invoiceTransaction(inv, outcome, when);
    const created = await this.write(customerId, fields, eventId, inv);
    if (!created) return;
    await this.prisma.customerSubscription.update({
      where: { customerId },
      data:
        outcome === 'paid'
          ? {
              lastPaymentStatus: 'SUCCEEDED',
              lastPaymentAt: when,
              lastFailureMessage: null,
              failedSince: null,
            }
          : {
              lastPaymentStatus: 'FAILED',
              lastPaymentAt: when,
              lastFailureMessage: fields.failureMessage,
            },
    });
    if (outcome !== 'paid')
      await this.prisma.customerSubscription.updateMany({
        where: { customerId, failedSince: null },
        data: { failedSince: when },
      });
    this.subs.forget(customerId);
    const level = outcome === 'paid' ? 'log' : 'warn';
    this.logger[level](
      `customer ${customerId} invoice ${inv.id} ${outcome.toUpperCase()} ${money(fields.amountCents, fields.currency)}` +
        (fields.failureMessage
          ? ` — ${fields.failureMessage}${fields.declineCode ? ` (${fields.declineCode})` : ''}`
          : ''),
    );
  }

  private async onRefund(
    charge: Stripe.Charge,
    when: Date,
    eventId: string,
  ): Promise<void> {
    const customerId = await this.customerOf(undefined, idOf(charge.customer));
    if (!customerId) return;
    await this.write(
      customerId,
      chargeTransaction(
        charge,
        'REFUND',
        when,
        charge.amount_refunded,
        String(charge.amount_refunded),
      ),
      eventId,
      charge,
    );
  }

  private async onDispute(
    dispute: Stripe.Dispute,
    when: Date,
    eventId: string,
  ): Promise<void> {
    const charge = await this.stripeClient.stripe.charges.retrieve(
      idOf(dispute.charge)!,
    );
    const customerId = await this.customerOf(undefined, idOf(charge.customer));
    if (!customerId) return;
    const fields = chargeTransaction(charge, 'DISPUTE', when, dispute.amount, dispute.id);
    fields.failureMessage = dispute.reason ?? null;
    await this.write(customerId, fields, eventId, dispute);
  }

  /** One row; false = it was already recorded (unique `recordKey`). */
  private async write(
    customerId: number,
    f: TransactionFields,
    eventId: string | null,
    raw: object,
  ): Promise<boolean> {
    const sub = await this.subs.row(customerId);
    try {
      await this.prisma.billingTransaction.create({
        data: {
          ...f,
          customerId,
          subscriptionId: sub.id,
          stripeEventId: eventId,
          raw: trimmed(raw) as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        return false;
      throw err;
    }
  }

  // ── Hourly sync: nothing is missed when a webhook is ──────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async syncAll(): Promise<void> {
    if (this.syncing || !this.stripeClient.configured) return;
    this.syncing = true;
    try {
      const stale = new Date(Date.now() - SYNC_EVERY_MS);
      const rows = await this.prisma.customerSubscription.findMany({
        where: {
          stripeSubscriptionId: { not: null },
          OR: [
            { syncedAt: null },
            { syncedAt: { lt: stale } },
            { currentPeriodEnd: { lt: new Date() }, status: { notIn: ['CANCELED', 'INCOMPLETE_EXPIRED'] } },
            { status: { in: ['PAST_DUE', 'INCOMPLETE'] } },
          ],
        },
        take: 200,
      });
      let invoices = 0;
      for (const row of rows) {
        try {
          await this.syncSubscription(row.stripeSubscriptionId!);
          invoices += await this.syncInvoices(row.stripeSubscriptionId!);
        } catch (err) {
          this.logger.warn(
            `sync of customer ${row.customerId} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      // Customers who paid in Checkout whose webhook never came: find their subscription.
      await this.adoptMissing();
      await this.ensureAllStripeCustomers();
      if (rows.length || invoices)
        this.logger.log(
          `hourly sync: ${rows.length} subscription(s), ${invoices} invoice row(s) recorded late`,
        );
    } finally {
      this.syncing = false;
    }
  }

  /** The last 40 days of a subscription's invoices; returns how many rows were new. */
  private async syncInvoices(subscriptionId: string): Promise<number> {
    const list = await this.stripeClient.stripe.invoices.list({
      subscription: subscriptionId,
      created: { gte: Math.floor(Date.now() / 1000) - 40 * 86_400 },
      limit: 20,
      expand: [
        'data.payments.data.payment.payment_intent.latest_charge',
        'data.payments.data.payment.payment_intent.payment_method',
      ],
    });
    let added = 0;
    for (const inv of list.data) {
      const outcome: InvoiceOutcome | null =
        inv.status === 'paid'
          ? 'paid'
          : inv.status === 'open' && (inv.attempt_count ?? 0) > 0
            ? 'failed'
            : null;
      if (!outcome) continue;
      const before = await this.prisma.billingTransaction.count({
        where: { stripeInvoiceId: inv.id },
      });
      await this.recordInvoice(
        inv,
        outcome,
        at(inv.status_transitions?.paid_at) ?? new Date(inv.created * 1000),
        null,
      );
      const after = await this.prisma.billingTransaction.count({
        where: { stripeInvoiceId: inv.id },
      });
      added += after - before;
    }
    return added;
  }

  /**
   * A Checkout completed in the last 72 h whose subscription we have no row for (its
   * `checkout.session.completed` was lost). One Stripe call, however many accounts there
   * are — every account has a Stripe Customer now, so listing per customer would not scale.
   */
  private async adoptMissing(): Promise<void> {
    const sessions = await this.stripeClient.stripe.checkout.sessions.list({
      status: 'complete',
      created: { gte: Math.floor(Date.now() / 1000) - 72 * 3_600 },
      limit: 100,
    });
    for (const s of sessions.data) {
      const subId = s.mode === 'subscription' ? idOf(s.subscription) : null;
      if (!subId) continue;
      const known = await this.prisma.customerSubscription.findFirst({
        where: { stripeSubscriptionId: subId },
        select: { id: true },
      });
      if (known) continue;
      try {
        await this.syncSubscription(subId);
        await this.syncInvoices(subId);
        await this.saveDefaultCard(subId);
        this.logger.log(`adopted subscription ${subId} (checkout ${s.id})`);
      } catch (err) {
        this.logger.warn(
          `adopt ${subId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * The card a Checkout saved becomes the Stripe Customer's default too (Checkout makes it
   * only the subscription's), so the Billing Portal shows it and anything billed later
   * uses it. Never throws.
   */
  private async saveDefaultCard(subscriptionId: string): Promise<void> {
    try {
      const sub = await this.stripeClient.stripe.subscriptions.retrieve(subscriptionId);
      const pm = idOf(sub.default_payment_method);
      const cus = idOf(sub.customer);
      if (!pm || !cus) return;
      await this.stripeClient.stripe.customers.update(cus, {
        invoice_settings: { default_payment_method: pm },
      });
    } catch (err) {
      this.logger.warn(
        `default card of ${subscriptionId} not saved: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * A Stripe Customer for every live account that has none (user's request 2026-11-25:
   * "every user should get a Stripe id"): 2 minutes after start, then hourly, 50 a run.
   * A failure is logged and tried again next hour; never throws.
   */
  async ensureAllStripeCustomers(): Promise<number> {
    if (this.ensuring || !this.stripeClient.configured) return 0;
    this.ensuring = true;
    let made = 0;
    try {
      const missing = await this.prisma.customer.findMany({
        where: { stripeCustomerId: null, deletedAt: null },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 50,
      });
      for (const c of missing) {
        try {
          await this.ensureStripeCustomer(c.id);
          made++;
        } catch (err) {
          this.logger.warn(
            `Stripe customer for customer ${c.id} not made: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (made) this.logger.log(`made ${made} Stripe customer(s)`);
    } catch (err) {
      this.logger.warn(
        `Stripe customer sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.ensuring = false;
    }
    return made;
  }

  /**
   * A new account's Stripe Customer, in the background — sign-up never waits on Stripe or
   * fails because of it (the hourly sweep makes it later when this one fails).
   */
  ensureStripeCustomerSoon(customerId: number): void {
    if (!this.stripeClient.configured) return;
    this.ensureStripeCustomer(customerId).catch((err) =>
      this.logger.warn(
        `Stripe customer for new customer ${customerId} not made: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  /**
   * The account's name, email and phone copied onto its Stripe Customer (receipts and
   * failed-payment emails go to Stripe's copy). Background; never throws.
   */
  syncStripeCustomerSoon(customerId: number): void {
    if (!this.stripeClient.configured) return;
    void (async () => {
      const c = await this.prisma.customer.findUnique({ where: { id: customerId } });
      if (!c?.stripeCustomerId || c.deletedAt) return;
      await this.stripeClient.stripe.customers.update(c.stripeCustomerId, {
        email: c.email ?? '',
        name: c.name || '',
        phone: c.phone ?? '',
      });
    })().catch((err) =>
      this.logger.warn(
        `Stripe customer of customer ${customerId} not updated: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async customerOf(
    metaId: string | undefined | null,
    stripeCustomerId: string | null,
  ): Promise<number | null> {
    const n = Number(metaId);
    if (Number.isInteger(n) && n > 0) {
      const c = await this.prisma.customer.findUnique({
        where: { id: n },
        select: { id: true },
      });
      if (c) return c.id;
    }
    if (!stripeCustomerId) return null;
    const c = await this.prisma.customer.findUnique({
      where: { stripeCustomerId },
      select: { id: true },
    });
    return c?.id ?? null;
  }

  async ensureStripeCustomer(customerId: number): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer || customer.deletedAt) throw new UnauthorizedException();
    if (customer.stripeCustomerId) return customer.stripeCustomerId;
    // The key makes a sweep and a Subscribe click racing each other create ONE customer.
    const created = await this.stripeClient.stripe.customers.create(
      {
        email: customer.email ?? undefined,
        name: customer.name || undefined,
        phone: customer.phone ?? undefined,
        metadata: { customerId: String(customerId) },
      },
      { idempotencyKey: `cyg-customer-${customerId}` },
    );
    // Only the first concurrent request wins; a loser uses the winner's id.
    const { count } = await this.prisma.customer.updateMany({
      where: { id: customerId, stripeCustomerId: null },
      data: { stripeCustomerId: created.id },
    });
    if (count) return created.id;
    const winner = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { stripeCustomerId: true },
    });
    return winner!.stripeCustomerId!;
  }
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  return !v ? null : typeof v === 'string' ? v : v.id;
}

function at(s: number | null | undefined): Date | null {
  return typeof s === 'number' && s > 0 ? new Date(s * 1000) : null;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export function money(cents: number, currency: string): string {
  const s = `$${(cents / 100).toFixed(2)}`;
  return currency.toLowerCase() === 'usd' ? `US${s}` : s;
}

function transactionView(r: BillingTransaction): BillingTransactionView {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    amountCents: r.amountCents,
    currency: r.currency,
    failureMessage: r.failureMessage,
    declineCode: r.declineCode,
    nextRetryAt: iso(r.nextRetryAt),
    cardBrand: r.cardBrand,
    cardLast4: r.cardLast4,
    hostedInvoiceUrl: r.hostedInvoiceUrl,
    invoicePdfUrl: r.invoicePdfUrl,
    receiptUrl: r.receiptUrl,
    periodStart: iso(r.periodStart),
    periodEnd: iso(r.periodEnd),
    promoCode: r.promoCode,
    occurredAt: r.occurredAt.toISOString(),
  };
}
