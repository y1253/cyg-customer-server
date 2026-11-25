"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var StripeBillingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripeBillingService = void 0;
exports.money = money;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const entitlement_util_1 = require("./entitlement.util");
const invoice_util_1 = require("./invoice.util");
const pricing_util_1 = require("./pricing.util");
const stripe_client_1 = require("./stripe.client");
const subscription_service_1 = require("./subscription.service");
const FINISHED = ['canceled', 'incomplete_expired'];
const SYNC_EVERY_MS = 6 * 3_600_000;
const PRICE_CACHE_MS = 3_600_000;
let StripeBillingService = StripeBillingService_1 = class StripeBillingService {
    prisma;
    config;
    stripeClient;
    subs;
    logger = new common_1.Logger(StripeBillingService_1.name);
    priceCache = null;
    syncing = false;
    constructor(prisma, config, stripeClient, subs) {
        this.prisma = prisma;
        this.config = config;
        this.stripeClient = stripeClient;
        this.subs = subs;
    }
    onModuleInit() {
        this.subs.priceText = async () => {
            const p = await this.price();
            return p ? money(p.priceCents, p.currency) : '$19.99';
        };
        if (this.stripeClient.configured && !this.stripeClient.webhookSecret)
            this.logger.error('STRIPE_WEBHOOK_SECRET is not set — subscription changes and failed payments arrive only through the hourly sync');
        if (this.stripeClient.configured && !this.stripeClient.priceId)
            this.logger.error('STRIPE_SUBSCRIPTION_PRICE_ID is not set — customers cannot subscribe');
    }
    async price() {
        if (this.priceCache && Date.now() - this.priceCache.at < PRICE_CACHE_MS)
            return this.priceCache.price;
        const id = this.stripeClient.priceId;
        if (!this.stripeClient.configured || !id)
            return null;
        try {
            const p = await this.stripeClient.stripe.prices.retrieve(id);
            const price = {
                priceCents: p.unit_amount ?? 0,
                currency: p.currency,
                interval: p.recurring?.interval ?? 'month',
            };
            this.priceCache = { at: Date.now(), price };
            return price;
        }
        catch (err) {
            this.logger.warn(`price ${id} could not be read: ${err instanceof Error ? err.message : String(err)}`);
            return this.priceCache?.price ?? null;
        }
    }
    async view(customerId) {
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
                ? { brand: withCard.cardBrand ?? 'card', last4: withCard.cardLast4 }
                : null,
            hasStripeCustomer: !!customer?.stripeCustomerId,
            transactions: rows.map(transactionView),
        };
    }
    async startCheckout(customerId) {
        const priceId = this.stripeClient.priceId;
        if (!priceId)
            throw new common_1.ServiceUnavailableException('Subscriptions are not set up yet — please contact us.');
        const sub = await this.subs.row(customerId);
        if (['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(sub.status))
            throw new common_1.ConflictException('Your plan is already active — manage it from Billing.');
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
            throw new common_1.ServiceUnavailableException('Stripe did not return a page.');
        this.logger.log(`checkout ${session.id} opened for customer ${customerId}`);
        return { url: session.url };
    }
    async portal(customerId) {
        const customer = await this.prisma.customer.findUnique({
            where: { id: customerId },
            select: { stripeCustomerId: true },
        });
        if (!customer?.stripeCustomerId)
            throw new common_1.NotFoundException('You have no billing account yet — subscribe first.');
        const session = await this.stripeClient.stripe.billingPortal.sessions.create({
            customer: customer.stripeCustomerId,
            return_url: `${this.subs.baseUrl()}/dashboard/account`,
        });
        return { url: session.url };
    }
    async redeemPromo(customerId, code) {
        const promo = await this.prisma.promoCode.findUnique({
            where: { code: (0, pricing_util_1.normalizeCode)(code) },
        });
        const problem = promo && promo.kind !== 'FREE_SUBSCRIPTION'
            ? 'That promo code is not valid.'
            : (0, pricing_util_1.promoProblem)(promo);
        if (problem)
            throw new common_1.BadRequestException(problem);
        const sub = await this.subs.row(customerId);
        if (['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(sub.status))
            throw new common_1.ConflictException('Your paid plan is active — cancel it first (Manage billing), or contact us.');
        if (sub.freeForever)
            throw new common_1.ConflictException('Your account is already free.');
        const used = await this.prisma.billingTransaction.findFirst({
            where: { customerId, promoCodeId: promo.id },
            select: { id: true },
        });
        if (used)
            throw new common_1.ConflictException('You already used that promo code.');
        const freeForever = promo.freeMonths === null;
        const freeUntil = freeForever
            ? null
            : (0, entitlement_util_1.freeUntilAfter)(sub.freeUntil, promo.freeMonths);
        await this.prisma.$transaction(async (tx) => {
            const { count } = await tx.promoCode.updateMany({
                where: {
                    id: promo.id,
                    ...(promo.maxUses !== null && { usedCount: { lt: promo.maxUses } }),
                },
                data: { usedCount: { increment: 1 } },
            });
            if (!count)
                throw new common_1.BadRequestException('That promo code has been fully used.');
            await tx.customerSubscription.update({
                where: { customerId },
                data: freeForever
                    ? { freeForever: true, freePromoCodeId: promo.id }
                    : { freeUntil, freePromoCodeId: promo.id },
            });
            await tx.billingTransaction.create({
                data: {
                    customerId,
                    subscriptionId: sub.id,
                    recordKey: `promo:${promo.id}:${customerId}`,
                    kind: 'FREE_PROMO',
                    status: 'FREE',
                    amountCents: 0,
                    promoCodeId: promo.id,
                    promoCode: promo.code,
                    periodStart: new Date(),
                    periodEnd: freeUntil,
                    occurredAt: new Date(),
                },
            });
        });
        this.subs.forget(customerId);
        this.logger.log(`customer ${customerId} redeemed ${promo.code}: ${freeForever ? 'free forever' : `free until ${freeUntil.toISOString()}`}`);
        return { freeUntil: iso(freeUntil), freeForever };
    }
    async handleWebhook(rawBody, signature) {
        const secret = this.stripeClient.webhookSecret;
        if (!secret)
            throw new common_1.NotFoundException();
        let event;
        try {
            event = this.stripeClient.stripe.webhooks.constructEvent(rawBody, signature, secret);
        }
        catch {
            throw new common_1.BadRequestException('Invalid signature');
        }
        const when = new Date(event.created * 1000);
        switch (event.type) {
            case 'checkout.session.completed': {
                const s = event.data.object;
                if (s.mode === 'subscription' && s.subscription)
                    await this.syncSubscription(idOf(s.subscription));
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
                await this.onInvoice(event.data.object.id, 'action_required', when, event.id);
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
    async syncSubscription(subscriptionId) {
        const sub = await this.stripeClient.stripe.subscriptions.retrieve(subscriptionId);
        const customerId = await this.customerOf(sub.metadata?.customerId, idOf(sub.customer));
        if (!customerId) {
            this.logger.warn(`subscription ${sub.id}: no customer of ours`);
            return;
        }
        const row = await this.subs.row(customerId);
        if (row.stripeSubscriptionId &&
            row.stripeSubscriptionId !== sub.id &&
            FINISHED.includes(sub.status) &&
            !['CANCELED', 'INCOMPLETE_EXPIRED', 'NONE'].includes(row.status))
            return;
        const status = (0, entitlement_util_1.statusFromStripe)(sub.status);
        const { start, end } = (0, invoice_util_1.periodOfSubscription)(sub);
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
            this.logger.log(`customer ${customerId} subscription ${sub.id}: ${row.status} → ${status}`);
        this.subs.forget(customerId);
    }
    async onInvoice(invoiceId, outcome, when, eventId) {
        const inv = await this.stripeClient.stripe.invoices.retrieve(invoiceId, {
            expand: [
                'payments.data.payment.payment_intent.latest_charge',
                'payments.data.payment.payment_intent.payment_method',
            ],
        });
        const subId = (0, invoice_util_1.subscriptionIdOfInvoice)(inv);
        if (!subId)
            return;
        await this.syncSubscription(subId);
        await this.recordInvoice(inv, outcome, when, eventId);
    }
    async recordInvoice(inv, outcome, when, eventId) {
        const customerId = await this.customerOf(inv.parent?.subscription_details?.metadata?.customerId, idOf(inv.customer));
        if (!customerId)
            return;
        const fields = (0, invoice_util_1.invoiceTransaction)(inv, outcome, when);
        const created = await this.write(customerId, fields, eventId, inv);
        if (!created)
            return;
        await this.prisma.customerSubscription.update({
            where: { customerId },
            data: outcome === 'paid'
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
        this.logger[level](`customer ${customerId} invoice ${inv.id} ${outcome.toUpperCase()} ${money(fields.amountCents, fields.currency)}` +
            (fields.failureMessage
                ? ` — ${fields.failureMessage}${fields.declineCode ? ` (${fields.declineCode})` : ''}`
                : ''));
    }
    async onRefund(charge, when, eventId) {
        const customerId = await this.customerOf(undefined, idOf(charge.customer));
        if (!customerId)
            return;
        await this.write(customerId, (0, invoice_util_1.chargeTransaction)(charge, 'REFUND', when, charge.amount_refunded, String(charge.amount_refunded)), eventId, charge);
    }
    async onDispute(dispute, when, eventId) {
        const charge = await this.stripeClient.stripe.charges.retrieve(idOf(dispute.charge));
        const customerId = await this.customerOf(undefined, idOf(charge.customer));
        if (!customerId)
            return;
        const fields = (0, invoice_util_1.chargeTransaction)(charge, 'DISPUTE', when, dispute.amount, dispute.id);
        fields.failureMessage = dispute.reason ?? null;
        await this.write(customerId, fields, eventId, dispute);
    }
    async write(customerId, f, eventId, raw) {
        const sub = await this.subs.row(customerId);
        try {
            await this.prisma.billingTransaction.create({
                data: {
                    ...f,
                    customerId,
                    subscriptionId: sub.id,
                    stripeEventId: eventId,
                    raw: (0, invoice_util_1.trimmed)(raw),
                },
            });
            return true;
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002')
                return false;
            throw err;
        }
    }
    async syncAll() {
        if (this.syncing || !this.stripeClient.configured)
            return;
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
                    await this.syncSubscription(row.stripeSubscriptionId);
                    invoices += await this.syncInvoices(row.stripeSubscriptionId);
                }
                catch (err) {
                    this.logger.warn(`sync of customer ${row.customerId} failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            await this.adoptMissing();
            if (rows.length || invoices)
                this.logger.log(`hourly sync: ${rows.length} subscription(s), ${invoices} invoice row(s) recorded late`);
        }
        finally {
            this.syncing = false;
        }
    }
    async syncInvoices(subscriptionId) {
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
            const outcome = inv.status === 'paid'
                ? 'paid'
                : inv.status === 'open' && (inv.attempt_count ?? 0) > 0
                    ? 'failed'
                    : null;
            if (!outcome)
                continue;
            const before = await this.prisma.billingTransaction.count({
                where: { stripeInvoiceId: inv.id },
            });
            await this.recordInvoice(inv, outcome, at(inv.status_transitions?.paid_at) ?? new Date(inv.created * 1000), null);
            const after = await this.prisma.billingTransaction.count({
                where: { stripeInvoiceId: inv.id },
            });
            added += after - before;
        }
        return added;
    }
    async adoptMissing() {
        const customers = await this.prisma.customer.findMany({
            where: {
                stripeCustomerId: { not: null },
                deletedAt: null,
                OR: [
                    { subscription: null },
                    { subscription: { stripeSubscriptionId: null } },
                ],
            },
            select: { id: true, stripeCustomerId: true },
            take: 100,
        });
        for (const c of customers) {
            try {
                const list = await this.stripeClient.stripe.subscriptions.list({
                    customer: c.stripeCustomerId,
                    status: 'all',
                    limit: 3,
                });
                const live = list.data.find((s) => !FINISHED.includes(s.status));
                if (live) {
                    await this.syncSubscription(live.id);
                    await this.syncInvoices(live.id);
                }
            }
            catch (err) {
                this.logger.warn(`adopt customer ${c.id} failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    async customerOf(metaId, stripeCustomerId) {
        const n = Number(metaId);
        if (Number.isInteger(n) && n > 0) {
            const c = await this.prisma.customer.findUnique({
                where: { id: n },
                select: { id: true },
            });
            if (c)
                return c.id;
        }
        if (!stripeCustomerId)
            return null;
        const c = await this.prisma.customer.findUnique({
            where: { stripeCustomerId },
            select: { id: true },
        });
        return c?.id ?? null;
    }
    async ensureStripeCustomer(customerId) {
        const customer = await this.prisma.customer.findUnique({
            where: { id: customerId },
        });
        if (!customer || customer.deletedAt)
            throw new common_1.UnauthorizedException();
        if (customer.stripeCustomerId)
            return customer.stripeCustomerId;
        const created = await this.stripeClient.stripe.customers.create({
            email: customer.email ?? undefined,
            name: customer.name || undefined,
            phone: customer.phone ?? undefined,
            metadata: { customerId: String(customerId) },
        });
        const { count } = await this.prisma.customer.updateMany({
            where: { id: customerId, stripeCustomerId: null },
            data: { stripeCustomerId: created.id },
        });
        if (count)
            return created.id;
        const winner = await this.prisma.customer.findUnique({
            where: { id: customerId },
            select: { stripeCustomerId: true },
        });
        return winner.stripeCustomerId;
    }
};
exports.StripeBillingService = StripeBillingService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_HOUR),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], StripeBillingService.prototype, "syncAll", null);
exports.StripeBillingService = StripeBillingService = StripeBillingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        stripe_client_1.StripeClient,
        subscription_service_1.SubscriptionService])
], StripeBillingService);
function idOf(v) {
    return !v ? null : typeof v === 'string' ? v : v.id;
}
function at(s) {
    return typeof s === 'number' && s > 0 ? new Date(s * 1000) : null;
}
function iso(d) {
    return d ? d.toISOString() : null;
}
function money(cents, currency) {
    const s = `$${(cents / 100).toFixed(2)}`;
    return currency.toLowerCase() === 'usd' ? `US${s}` : s;
}
function transactionView(r) {
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
//# sourceMappingURL=stripe-billing.service.js.map