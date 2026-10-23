import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentStatus, Prisma, type PromoCode } from '@prisma/client';
import Stripe from 'stripe';
import { BookkeepingService } from '../bookkeeping/bookkeeping.service';
import { legacyBook } from '../bookkeeping/books';
import { bookLabel, scopeWhere, type BookScope } from '../bookkeeping/scope';
import { PrismaService } from '../prisma/prisma.service';
import { readPricing } from './pricing';
import { normalizeCode, priceFor, promoProblem } from './pricing.util';
import { StripeClient } from './stripe.client';

export interface QuoteView {
  listPriceCents: number;
  amountCents: number;
  currency: string;
  promo: { code: string; kind: PromoCode['kind']; value: number } | null;
}

export interface BillingConfigView {
  publishableKey: string | null;
  priceCents: number;
  currency: string;
}

export interface SavedCardView {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

type GenerateResult = { queued: number; taxing: boolean };

/** `done` = paid (or free) and Generate already ran; otherwise the client confirms the card. */
export type CheckoutView =
  | { done: true; amountCents: number; result: GenerateResult }
  | {
      done: false;
      amountCents: number;
      clientSecret: string;
      paymentIntentId: string;
      status: Stripe.PaymentIntent.Status;
    };

/** Tags every PaymentIntent this server makes, so the webhook ignores anything else. */
const PURPOSE = 'generate';

/** A positive id from PaymentIntent metadata, else null. */
function metaId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Pay per Generate. The price is ALWAYS recomputed here from the admin's price and the
 * promo row — the client's numbers are display only. A $0 total never touches Stripe.
 * A payment is recorded exactly once (`CustomerPayment.stripePaymentIntentId` is unique),
 * by whichever of `complete` / the webhook gets there first, and only that one generates.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
    private readonly bookkeeping: BookkeepingService,
  ) {}

  async config(): Promise<BillingConfigView> {
    const pricing = await readPricing(this.prisma);
    return {
      publishableKey: this.stripeClient.publishableKey,
      priceCents: pricing.generatePriceCents,
      currency: pricing.currency,
    };
  }

  async quote(promoCode?: string): Promise<QuoteView> {
    const pricing = await readPricing(this.prisma);
    const promo = promoCode?.trim() ? await this.usablePromo(promoCode) : null;
    return {
      listPriceCents: pricing.generatePriceCents,
      amountCents: priceFor(pricing.generatePriceCents, promo),
      currency: pricing.currency,
      promo: promo
        ? { code: promo.code, kind: promo.kind, value: promo.value }
        : null,
    };
  }

  /** The customer's saved cards, newest first. None before their first paid Generate. */
  async cards(customerId: number): Promise<SavedCardView[]> {
    const stripeCustomerId = await this.stripeCustomerIdOf(customerId);
    if (!stripeCustomerId || !this.stripeClient.configured) return [];
    const list = await this.stripeClient.stripe.customers.listPaymentMethods(
      stripeCustomerId,
      { type: 'card', limit: 20 },
    );
    return list.data
      .filter((pm) => pm.card)
      .sort((a, b) => b.created - a.created)
      .map((pm) => ({
        id: pm.id,
        brand: pm.card!.brand,
        last4: pm.card!.last4,
        expMonth: pm.card!.exp_month,
        expYear: pm.card!.exp_year,
      }));
  }

  async removeCard(customerId: number, paymentMethodId: string): Promise<void> {
    await this.ownCard(customerId, paymentMethodId);
    await this.stripeClient.stripe.paymentMethods.detach(paymentMethodId);
  }

  async checkout(
    scope: BookScope,
    promoCode: string | undefined,
    paymentMethodId: string | undefined,
  ): Promise<CheckoutView> {
    const { customerId } = scope;
    const waiting = await this.bookkeeping.waitingCount(scope);
    if (!waiting)
      throw new BadRequestException(
        'There are no new statements to read — upload one first.',
      );

    const pricing = await readPricing(this.prisma);
    const promo = promoCode?.trim() ? await this.usablePromo(promoCode) : null;
    const amountCents = priceFor(pricing.generatePriceCents, promo);

    if (amountCents === 0) {
      const result = await this.recordFree(scope, pricing, promo);
      return { done: true, amountCents: 0, result };
    }

    const customer = await this.ensureStripeCustomer(customerId);
    if (paymentMethodId) await this.ownCard(customerId, paymentMethodId);

    const params: Stripe.PaymentIntentCreateParams = {
      amount: amountCents,
      currency: pricing.currency,
      customer: customer.stripeCustomerId,
      allowed_payment_method_types: ['card'],
      // Saves the card on the Stripe Customer for the next Generate.
      setup_future_usage: 'off_session',
      receipt_email: customer.email ?? undefined,
      description: `CYG Finance bookkeeping — Generate (${waiting} statement${waiting === 1 ? '' : 's'})`,
      metadata: {
        purpose: PURPOSE,
        customerId: String(customerId),
        // Which book this Generate reads (step12c `bookId`). Validated by BookScopeGuard
        // at checkout; `recordAndGenerate` reads it back from Stripe.
        bookId: String(scope.bookId),
        companyId: scope.companyId === null ? '' : String(scope.companyId),
        listPriceCents: String(pricing.generatePriceCents),
        promoCodeId: promo ? String(promo.id) : '',
        promoCode: promo?.code ?? '',
      },
    };
    if (paymentMethodId) {
      params.payment_method = paymentMethodId;
      params.confirm = true;
    }

    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.stripeClient.stripe.paymentIntents.create(params);
    } catch (err) {
      throw this.cardError(err);
    }

    if (intent.status === 'succeeded') {
      const result = await this.recordAndGenerate(intent.id);
      return { done: true, amountCents, result };
    }
    return {
      done: false,
      amountCents,
      clientSecret: intent.client_secret!,
      paymentIntentId: intent.id,
      status: intent.status,
    };
  }

  /** The client confirmed the card; check with Stripe (never trust the client) and generate. */
  async complete(
    scope: BookScope,
    paymentIntentId: string,
  ): Promise<GenerateResult> {
    const intent = await this.retrieveIntent(paymentIntentId);
    if (
      intent.metadata.customerId !== String(scope.customerId) ||
      (await this.scopeOfIntent(intent)).bookId !== scope.bookId
    )
      throw new NotFoundException('Payment not found');
    if (intent.status !== 'succeeded')
      throw new BadRequestException('The payment has not gone through yet.');
    return this.recordAndGenerate(intent.id);
  }

  /** `payment_intent.succeeded` — the safety net for a customer who closed the tab. */
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
    if (event.type !== 'payment_intent.succeeded') return;
    const intent = event.data.object;
    if (intent.metadata?.purpose !== PURPOSE) return;
    await this.recordAndGenerate(intent.id);
  }

  /**
   * Records a succeeded PaymentIntent and runs Generate — exactly once per intent. A second
   * call (the webhook after `complete`, a double click) hits the unique key and returns
   * without generating again.
   */
  private async recordAndGenerate(
    paymentIntentId: string,
  ): Promise<GenerateResult> {
    const intent = await this.retrieveIntent(paymentIntentId);
    const scope = await this.scopeOfIntent(intent);
    const charge =
      typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
    const card = charge?.payment_method_details?.card ?? null;
    const promoCodeId = Number(intent.metadata.promoCodeId) || null;

    let paymentId: number;
    try {
      paymentId = await this.prisma.$transaction(async (tx) => {
        const row = await tx.customerPayment.create({
          data: {
            ...scopeWhere(scope),
            stripePaymentIntentId: intent.id,
            stripeCustomerId:
              typeof intent.customer === 'string'
                ? intent.customer
                : (intent.customer?.id ?? null),
            amountCents: intent.amount_received || intent.amount,
            listPriceCents: Number(intent.metadata.listPriceCents) || 0,
            currency: intent.currency,
            promoCodeId,
            promoCode: intent.metadata.promoCode || null,
            status: PaymentStatus.SUCCEEDED,
            cardBrand: card?.brand ?? null,
            cardLast4: card?.last4 ?? null,
            cardExpMonth: card?.exp_month ?? null,
            cardExpYear: card?.exp_year ?? null,
            receiptUrl: charge?.receipt_url ?? null,
          },
        });
        if (promoCodeId)
          await tx.promoCode.update({
            where: { id: promoCodeId },
            data: { usedCount: { increment: 1 } },
          });
        return row.id;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        return { queued: 0, taxing: false };
      throw err;
    }

    this.logger.log(
      `payment ${intent.id} recorded for ${bookLabel(scope)} (${intent.amount} ${intent.currency})`,
    );
    return this.generateFor(scope, paymentId);
  }

  /** A $0 Generate (free promo): a FREE row, no Stripe at all. */
  private async recordFree(
    scope: BookScope,
    pricing: { generatePriceCents: number; currency: string },
    promo: PromoCode | null,
  ): Promise<GenerateResult> {
    const paymentId = await this.prisma.$transaction(async (tx) => {
      if (promo) {
        // Conditional increment: two customers racing for the last use can't both win.
        const { count } = await tx.promoCode.updateMany({
          where: {
            id: promo.id,
            ...(promo.maxUses !== null && { usedCount: { lt: promo.maxUses } }),
          },
          data: { usedCount: { increment: 1 } },
        });
        if (!count)
          throw new BadRequestException('That promo code has been fully used.');
      }
      const row = await tx.customerPayment.create({
        data: {
          ...scopeWhere(scope),
          amountCents: 0,
          listPriceCents: pricing.generatePriceCents,
          currency: pricing.currency,
          promoCodeId: promo?.id ?? null,
          promoCode: promo?.code ?? null,
          status: PaymentStatus.FREE,
        },
      });
      return row.id;
    });
    return this.generateFor(scope, paymentId);
  }

  private async generateFor(
    scope: BookScope,
    paymentId: number,
  ): Promise<GenerateResult> {
    const result = await this.bookkeeping.generate(scope);
    await this.prisma.customerPayment.update({
      where: { id: paymentId },
      data: { statementsQueued: result.queued },
    });
    return result;
  }

  private async usablePromo(code: string): Promise<PromoCode> {
    const promo = await this.prisma.promoCode.findUnique({
      where: { code: normalizeCode(code) },
    });
    const problem = promoProblem(promo);
    if (problem) throw new BadRequestException(problem);
    return promo!;
  }

  private async stripeCustomerIdOf(customerId: number): Promise<string | null> {
    const row = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { stripeCustomerId: true },
    });
    return row?.stripeCustomerId ?? null;
  }

  /** The Stripe Customer for this account, created on the first paid Generate. */
  /**
   * The book a PaymentIntent paid for, from its metadata: `bookId` (step12c); before that
   * `companyId` ('' = the general book, now the customer's default book).
   */
  private scopeOfIntent(intent: Stripe.PaymentIntent): Promise<BookScope> {
    return legacyBook(this.prisma, Number(intent.metadata.customerId), {
      bookId: metaId(intent.metadata.bookId),
      companyId: metaId(intent.metadata.companyId),
    });
  }

  private async ensureStripeCustomer(
    customerId: number,
  ): Promise<{ stripeCustomerId: string; email: string | null }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer || customer.deletedAt) throw new UnauthorizedException();
    if (customer.stripeCustomerId)
      return {
        stripeCustomerId: customer.stripeCustomerId,
        email: customer.email,
      };

    const created = await this.stripeClient.stripe.customers.create({
      // step12c: an account opened by phone may have no email.
      email: customer.email ?? undefined,
      name: customer.name,
      phone: customer.phone ?? undefined,
      metadata: { customerId: String(customerId) },
    });
    // Only the first concurrent checkout wins; a loser uses the winner's id.
    const { count } = await this.prisma.customer.updateMany({
      where: { id: customerId, stripeCustomerId: null },
      data: { stripeCustomerId: created.id },
    });
    if (count) return { stripeCustomerId: created.id, email: customer.email };
    const winner = await this.stripeCustomerIdOf(customerId);
    return { stripeCustomerId: winner!, email: customer.email };
  }

  /** 404 unless the card is saved on THIS customer's Stripe Customer. */
  private async ownCard(customerId: number, paymentMethodId: string) {
    const stripeCustomerId = await this.stripeCustomerIdOf(customerId);
    if (!stripeCustomerId) throw new NotFoundException('Card not found');
    let pm: Stripe.PaymentMethod;
    try {
      pm =
        await this.stripeClient.stripe.paymentMethods.retrieve(paymentMethodId);
    } catch {
      throw new NotFoundException('Card not found');
    }
    const owner =
      typeof pm.customer === 'string' ? pm.customer : pm.customer?.id;
    if (owner !== stripeCustomerId)
      throw new NotFoundException('Card not found');
  }

  private retrieveIntent(id: string): Promise<Stripe.PaymentIntent> {
    return this.stripeClient.stripe.paymentIntents
      .retrieve(id, { expand: ['latest_charge'] })
      .catch(() => {
        throw new NotFoundException('Payment not found');
      });
  }

  /** A declined card is the customer's to fix: pass Stripe's message through as a 400. */
  private cardError(err: unknown): Error {
    if (err instanceof Stripe.errors.StripeCardError)
      return new BadRequestException(err.message);
    this.logger.error(
      `Stripe checkout failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return err instanceof Error ? err : new Error(String(err));
  }
}
