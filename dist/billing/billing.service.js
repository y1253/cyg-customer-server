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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var BillingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const stripe_1 = __importDefault(require("stripe"));
const bookkeeping_service_1 = require("../bookkeeping/bookkeeping.service");
const prisma_service_1 = require("../prisma/prisma.service");
const pricing_1 = require("./pricing");
const pricing_util_1 = require("./pricing.util");
const stripe_client_1 = require("./stripe.client");
const PURPOSE = 'generate';
let BillingService = BillingService_1 = class BillingService {
    prisma;
    stripeClient;
    bookkeeping;
    logger = new common_1.Logger(BillingService_1.name);
    constructor(prisma, stripeClient, bookkeeping) {
        this.prisma = prisma;
        this.stripeClient = stripeClient;
        this.bookkeeping = bookkeeping;
    }
    async config() {
        const pricing = await (0, pricing_1.readPricing)(this.prisma);
        return {
            publishableKey: this.stripeClient.publishableKey,
            priceCents: pricing.generatePriceCents,
            currency: pricing.currency,
        };
    }
    async quote(promoCode) {
        const pricing = await (0, pricing_1.readPricing)(this.prisma);
        const promo = promoCode?.trim() ? await this.usablePromo(promoCode) : null;
        return {
            listPriceCents: pricing.generatePriceCents,
            amountCents: (0, pricing_util_1.priceFor)(pricing.generatePriceCents, promo),
            currency: pricing.currency,
            promo: promo
                ? { code: promo.code, kind: promo.kind, value: promo.value }
                : null,
        };
    }
    async cards(customerId) {
        const stripeCustomerId = await this.stripeCustomerIdOf(customerId);
        if (!stripeCustomerId || !this.stripeClient.configured)
            return [];
        const list = await this.stripeClient.stripe.customers.listPaymentMethods(stripeCustomerId, { type: 'card', limit: 20 });
        return list.data
            .filter((pm) => pm.card)
            .sort((a, b) => b.created - a.created)
            .map((pm) => ({
            id: pm.id,
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
        }));
    }
    async removeCard(customerId, paymentMethodId) {
        await this.ownCard(customerId, paymentMethodId);
        await this.stripeClient.stripe.paymentMethods.detach(paymentMethodId);
    }
    async checkout(customerId, promoCode, paymentMethodId) {
        const waiting = await this.bookkeeping.waitingCount(customerId);
        if (!waiting)
            throw new common_1.BadRequestException('There are no new statements to read — upload one first.');
        const pricing = await (0, pricing_1.readPricing)(this.prisma);
        const promo = promoCode?.trim() ? await this.usablePromo(promoCode) : null;
        const amountCents = (0, pricing_util_1.priceFor)(pricing.generatePriceCents, promo);
        if (amountCents === 0) {
            const result = await this.recordFree(customerId, pricing, promo);
            return { done: true, amountCents: 0, result };
        }
        const customer = await this.ensureStripeCustomer(customerId);
        if (paymentMethodId)
            await this.ownCard(customerId, paymentMethodId);
        const params = {
            amount: amountCents,
            currency: pricing.currency,
            customer: customer.stripeCustomerId,
            allowed_payment_method_types: ['card'],
            setup_future_usage: 'off_session',
            receipt_email: customer.email,
            description: `CYG Finance bookkeeping — Generate (${waiting} statement${waiting === 1 ? '' : 's'})`,
            metadata: {
                purpose: PURPOSE,
                customerId: String(customerId),
                listPriceCents: String(pricing.generatePriceCents),
                promoCodeId: promo ? String(promo.id) : '',
                promoCode: promo?.code ?? '',
            },
        };
        if (paymentMethodId) {
            params.payment_method = paymentMethodId;
            params.confirm = true;
        }
        let intent;
        try {
            intent = await this.stripeClient.stripe.paymentIntents.create(params);
        }
        catch (err) {
            throw this.cardError(err);
        }
        if (intent.status === 'succeeded') {
            const result = await this.recordAndGenerate(intent.id);
            return { done: true, amountCents, result };
        }
        return {
            done: false,
            amountCents,
            clientSecret: intent.client_secret,
            paymentIntentId: intent.id,
            status: intent.status,
        };
    }
    async complete(customerId, paymentIntentId) {
        const intent = await this.retrieveIntent(paymentIntentId);
        if (intent.metadata.customerId !== String(customerId))
            throw new common_1.NotFoundException('Payment not found');
        if (intent.status !== 'succeeded')
            throw new common_1.BadRequestException('The payment has not gone through yet.');
        return this.recordAndGenerate(intent.id);
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
        if (event.type !== 'payment_intent.succeeded')
            return;
        const intent = event.data.object;
        if (intent.metadata?.purpose !== PURPOSE)
            return;
        await this.recordAndGenerate(intent.id);
    }
    async recordAndGenerate(paymentIntentId) {
        const intent = await this.retrieveIntent(paymentIntentId);
        const customerId = Number(intent.metadata.customerId);
        const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
        const card = charge?.payment_method_details?.card ?? null;
        const promoCodeId = Number(intent.metadata.promoCodeId) || null;
        let paymentId;
        try {
            paymentId = await this.prisma.$transaction(async (tx) => {
                const row = await tx.customerPayment.create({
                    data: {
                        customerId,
                        stripePaymentIntentId: intent.id,
                        stripeCustomerId: typeof intent.customer === 'string'
                            ? intent.customer
                            : (intent.customer?.id ?? null),
                        amountCents: intent.amount_received || intent.amount,
                        listPriceCents: Number(intent.metadata.listPriceCents) || 0,
                        currency: intent.currency,
                        promoCodeId,
                        promoCode: intent.metadata.promoCode || null,
                        status: client_1.PaymentStatus.SUCCEEDED,
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
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002')
                return { queued: 0, taxing: false };
            throw err;
        }
        this.logger.log(`payment ${intent.id} recorded for customer ${customerId} (${intent.amount} ${intent.currency})`);
        return this.generateFor(customerId, paymentId);
    }
    async recordFree(customerId, pricing, promo) {
        const paymentId = await this.prisma.$transaction(async (tx) => {
            if (promo) {
                const { count } = await tx.promoCode.updateMany({
                    where: {
                        id: promo.id,
                        ...(promo.maxUses !== null && { usedCount: { lt: promo.maxUses } }),
                    },
                    data: { usedCount: { increment: 1 } },
                });
                if (!count)
                    throw new common_1.BadRequestException('That promo code has been fully used.');
            }
            const row = await tx.customerPayment.create({
                data: {
                    customerId,
                    amountCents: 0,
                    listPriceCents: pricing.generatePriceCents,
                    currency: pricing.currency,
                    promoCodeId: promo?.id ?? null,
                    promoCode: promo?.code ?? null,
                    status: client_1.PaymentStatus.FREE,
                },
            });
            return row.id;
        });
        return this.generateFor(customerId, paymentId);
    }
    async generateFor(customerId, paymentId) {
        const result = await this.bookkeeping.generate(customerId);
        await this.prisma.customerPayment.update({
            where: { id: paymentId },
            data: { statementsQueued: result.queued },
        });
        return result;
    }
    async usablePromo(code) {
        const promo = await this.prisma.promoCode.findUnique({
            where: { code: (0, pricing_util_1.normalizeCode)(code) },
        });
        const problem = (0, pricing_util_1.promoProblem)(promo);
        if (problem)
            throw new common_1.BadRequestException(problem);
        return promo;
    }
    async stripeCustomerIdOf(customerId) {
        const row = await this.prisma.customer.findUnique({
            where: { id: customerId },
            select: { stripeCustomerId: true },
        });
        return row?.stripeCustomerId ?? null;
    }
    async ensureStripeCustomer(customerId) {
        const customer = await this.prisma.customer.findUnique({
            where: { id: customerId },
        });
        if (!customer || customer.deletedAt)
            throw new common_1.UnauthorizedException();
        if (customer.stripeCustomerId)
            return {
                stripeCustomerId: customer.stripeCustomerId,
                email: customer.email,
            };
        const created = await this.stripeClient.stripe.customers.create({
            email: customer.email,
            name: customer.name,
            phone: customer.phone ?? undefined,
            metadata: { customerId: String(customerId) },
        });
        const { count } = await this.prisma.customer.updateMany({
            where: { id: customerId, stripeCustomerId: null },
            data: { stripeCustomerId: created.id },
        });
        if (count)
            return { stripeCustomerId: created.id, email: customer.email };
        const winner = await this.stripeCustomerIdOf(customerId);
        return { stripeCustomerId: winner, email: customer.email };
    }
    async ownCard(customerId, paymentMethodId) {
        const stripeCustomerId = await this.stripeCustomerIdOf(customerId);
        if (!stripeCustomerId)
            throw new common_1.NotFoundException('Card not found');
        let pm;
        try {
            pm =
                await this.stripeClient.stripe.paymentMethods.retrieve(paymentMethodId);
        }
        catch {
            throw new common_1.NotFoundException('Card not found');
        }
        const owner = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id;
        if (owner !== stripeCustomerId)
            throw new common_1.NotFoundException('Card not found');
    }
    retrieveIntent(id) {
        return this.stripeClient.stripe.paymentIntents
            .retrieve(id, { expand: ['latest_charge'] })
            .catch(() => {
            throw new common_1.NotFoundException('Payment not found');
        });
    }
    cardError(err) {
        if (err instanceof stripe_1.default.errors.StripeCardError)
            return new common_1.BadRequestException(err.message);
        this.logger.error(`Stripe checkout failed: ${err instanceof Error ? err.message : String(err)}`);
        return err instanceof Error ? err : new Error(String(err));
    }
};
exports.BillingService = BillingService;
exports.BillingService = BillingService = BillingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        stripe_client_1.StripeClient,
        bookkeeping_service_1.BookkeepingService])
], BillingService);
//# sourceMappingURL=billing.service.js.map