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
var SubscriptionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionService = exports.TransactionLimitException = exports.SubscriptionRequiredException = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mail_service_1 = require("../mail/mail.service");
const customer_messenger_service_1 = require("../messaging/customer-messenger.service");
const prisma_service_1 = require("../prisma/prisma.service");
const billing_hooks_1 = require("./billing-hooks");
const entitlement_util_1 = require("./entitlement.util");
const CACHE_MS = 30_000;
const PLAN_CACHE_MS = 60_000;
class SubscriptionRequiredException extends common_1.HttpException {
    constructor(reason, message) {
        super({ statusCode: 402, code: 'SUBSCRIPTION_REQUIRED', reason, message }, common_1.HttpStatus.PAYMENT_REQUIRED);
    }
}
exports.SubscriptionRequiredException = SubscriptionRequiredException;
class TransactionLimitException extends common_1.HttpException {
    constructor(state) {
        const trial = state.limited === 'TRIAL';
        super({
            statusCode: 429,
            code: 'TRANSACTION_LIMIT',
            message: trial
                ? `Your free trial's ${state.trial?.transactions.limit ?? 0} transactions are used up — subscribe to read more.`
                : `You reached your ${state.monthly?.limit.toLocaleString('en-US') ?? ''} transactions for this month. It resets on ${state.monthly ? new Date(state.monthly.resetsAt).toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: 'long', day: 'numeric' }) : 'the 1st'}.`,
            used: trial ? state.trial?.transactions.used : state.monthly?.used,
            limit: trial ? state.trial?.transactions.limit : state.monthly?.limit,
            resetsAt: trial ? null : (state.monthly?.resetsAt ?? null),
        }, common_1.HttpStatus.TOO_MANY_REQUESTS);
    }
}
exports.TransactionLimitException = TransactionLimitException;
let SubscriptionService = SubscriptionService_1 = class SubscriptionService {
    prisma;
    config;
    messenger;
    mail;
    logger = new common_1.Logger(SubscriptionService_1.name);
    planCache = null;
    cache = new Map();
    constructor(prisma, config, messenger, mail) {
        this.prisma = prisma;
        this.config = config;
        this.messenger = messenger;
        this.mail = mail;
    }
    onModuleInit() {
        billing_hooks_1.billingHooks.usageChanged = (customerId) => this.forget(customerId);
        billing_hooks_1.billingHooks.allowText = (customerId, purpose) => this.allowText(customerId, purpose);
    }
    forget(customerId) {
        this.cache.delete(customerId);
    }
    async plan() {
        if (this.planCache && Date.now() - this.planCache.at < PLAN_CACHE_MS)
            return this.planCache.plan;
        const plan = await this.prisma.subscriptionPlan.upsert({
            where: { singleton: 'GLOBAL' },
            create: {},
            update: {},
        });
        this.planCache = { at: Date.now(), plan };
        return plan;
    }
    async row(customerId) {
        const found = await this.prisma.customerSubscription.findUnique({
            where: { customerId },
        });
        if (found)
            return found;
        try {
            return await this.prisma.customerSubscription.create({
                data: { customerId, trialStartedAt: new Date() },
            });
        }
        catch {
            return this.prisma.customerSubscription.findUniqueOrThrow({
                where: { customerId },
            });
        }
    }
    async state(customerId) {
        const hit = this.cache.get(customerId);
        if (hit && Date.now() - hit.at < CACHE_MS)
            return hit.state;
        const state = await this.compute(customerId);
        this.cache.set(customerId, { at: Date.now(), state });
        return state;
    }
    async compute(customerId) {
        const [sub, plan] = await Promise.all([this.row(customerId), this.plan()]);
        const allowance = {
            transactions: plan.trialTransactions,
            texts: plan.trialTexts,
            callMinutes: plan.trialCallMinutes,
        };
        const trialUsed = sub.everPaid
            ? null
            : await this.trialUsage(customerId, sub.trialStartedAt ?? sub.createdAt);
        const access = (0, entitlement_util_1.accessOf)(sub, trialUsed ? { allowance, used: trialUsed } : null);
        const usedUp = trialUsed ? (0, entitlement_util_1.trialUsedUp)(allowance, trialUsed) : [];
        const trial = trialUsed && (access.reason === 'TRIAL' || access.reason === 'TRIAL_USED')
            ? {
                transactions: {
                    used: trialUsed.transactions,
                    limit: allowance.transactions,
                },
                texts: { used: trialUsed.texts, limit: allowance.texts },
                callMinutes: {
                    used: trialUsed.callMinutes,
                    limit: allowance.callMinutes,
                },
                usedUp,
            }
            : null;
        let monthly = null;
        if (access.limited === 'MONTHLY') {
            const month = (0, entitlement_util_1.monthOf)();
            const used = await this.monthUsed(customerId, month);
            const limit = sub.transactionLimit ?? plan.monthlyTransactionLimit;
            monthly = {
                month,
                used,
                limit,
                ...(0, entitlement_util_1.monthlyUsage)(used, limit, plan.warnPercent),
                resetsAt: (0, entitlement_util_1.nextMonthStart)().toISOString(),
            };
        }
        return {
            ...access,
            trial,
            monthly,
            lockedText: access.active ? null : (0, entitlement_util_1.lockedText)(access.reason, usedUp),
        };
    }
    async trialUsage(customerId, since) {
        const [tx, texts, calls] = await Promise.all([
            this.prisma.transactionUsage.aggregate({
                where: { customerId, createdAt: { gte: since } },
                _sum: { transactions: true },
            }),
            this.prisma.commMessage.count({
                where: {
                    customerId,
                    direction: 'OUT',
                    createdAt: { gte: since },
                    purpose: { notIn: [...entitlement_util_1.FREE_TEXT_PURPOSES] },
                },
            }),
            this.prisma.commCall.findMany({
                where: {
                    customerId,
                    createdAt: { gte: since },
                    purpose: { not: 'PROSPECT' },
                },
                select: { durationSec: true },
            }),
        ]);
        return {
            transactions: tx._sum.transactions ?? 0,
            texts,
            callMinutes: calls.reduce((n, c) => n + Math.ceil(Math.max(0, c.durationSec) / 60), 0),
        };
    }
    async monthUsed(customerId, month) {
        const r = await this.prisma.transactionUsage.aggregate({
            where: { customerId, month },
            _sum: { transactions: true },
        });
        return r._sum.transactions ?? 0;
    }
    async assertActive(customerId) {
        const state = await this.state(customerId);
        if (!state.active)
            throw new SubscriptionRequiredException(state.reason, state.lockedText ?? 'Subscribe to keep going.');
        return state;
    }
    async remainingTransactions(customerId) {
        const s = await this.state(customerId);
        if (!s.active)
            return 0;
        if (s.limited === 'TRIAL' && s.trial)
            return Math.max(0, s.trial.transactions.limit - s.trial.transactions.used);
        if (s.limited === 'MONTHLY' && s.monthly)
            return s.monthly.remaining;
        return Number.POSITIVE_INFINITY;
    }
    async assertCanAddTransactions(customerId) {
        const state = await this.assertActive(customerId);
        if ((await this.remainingTransactions(customerId)) <= 0)
            throw new TransactionLimitException(state);
    }
    async callMinutesLeft(customerId) {
        const s = await this.state(customerId);
        if (!s.active)
            return 0;
        if (s.limited === 'TRIAL' && s.trial)
            return Math.max(0, s.trial.callMinutes.limit - s.trial.callMinutes.used);
        return null;
    }
    async allowText(customerId, purpose) {
        if (entitlement_util_1.FREE_TEXT_PURPOSES.includes(purpose))
            return true;
        try {
            const s = await this.state(customerId);
            if (!s.active)
                return false;
            if (s.limited !== 'TRIAL' || !s.trial)
                return true;
            return s.trial.texts.used < s.trial.texts.limit;
        }
        catch {
            return true;
        }
    }
    async recordUsage(scope, source, transactions, ref) {
        if (source === 'BANK_FEED' && transactions <= 0)
            return;
        try {
            await this.prisma.transactionUsage.createMany({
                data: [
                    {
                        customerId: scope.customerId,
                        bookId: scope.bookId,
                        month: (0, entitlement_util_1.monthOf)(),
                        source,
                        statementId: ref.statementId ?? null,
                        plaidItemId: ref.plaidItemId ?? null,
                        transactions: Math.max(0, transactions),
                    },
                ],
                skipDuplicates: true,
            });
        }
        catch (err) {
            this.logger.warn(`usage of customer ${scope.customerId} not recorded: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        this.forget(scope.customerId);
        await this.notices(scope.customerId).catch(() => undefined);
    }
    async statementCounted(statementId) {
        const row = await this.prisma.transactionUsage.findUnique({
            where: { statementId },
            select: { id: true },
        });
        return !!row;
    }
    async notices(customerId) {
        const s = await this.state(customerId);
        const sub = await this.row(customerId);
        if (s.reason === 'TRIAL_USED' && !sub.trialEndedNotifiedAt) {
            const { count } = await this.prisma.customerSubscription.updateMany({
                where: { customerId, trialEndedNotifiedAt: null },
                data: { trialEndedNotifiedAt: new Date() },
            });
            if (count)
                await this.notify(customerId, 'TRIAL_NOTICE', `Your CYG Finance free trial is over. Subscribe for ${await this.priceLabel()} a month to keep your books, the AI and your bank feeds going: ${this.baseUrl()}/dashboard/subscribe`, 'Your free trial is over');
            return;
        }
        const m = s.monthly;
        if (!m)
            return;
        if (m.reached && sub.limitMonth !== m.month) {
            const { count } = await this.prisma.customerSubscription.updateMany({
                where: { customerId, OR: [{ limitMonth: null }, { limitMonth: { not: m.month } }] },
                data: { limitMonth: m.month, warnedMonth: m.month },
            });
            if (count)
                await this.notify(customerId, 'USAGE_LIMIT', `You reached your ${m.limit.toLocaleString('en-US')} transactions for this month on CYG Finance. New statements and bank transactions wait until ${new Date(m.resetsAt).toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: 'long', day: 'numeric' })}, then they are read by themselves.`, 'Monthly transaction limit reached');
        }
        else if (m.warn && !m.reached && sub.warnedMonth !== m.month) {
            const { count } = await this.prisma.customerSubscription.updateMany({
                where: { customerId, OR: [{ warnedMonth: null }, { warnedMonth: { not: m.month } }] },
                data: { warnedMonth: m.month },
            });
            if (count)
                await this.notify(customerId, 'USAGE_LIMIT', `Heads up: you have used ${m.used.toLocaleString('en-US')} of your ${m.limit.toLocaleString('en-US')} transactions this month on CYG Finance.`, 'Transactions this month');
        }
    }
    async notify(customerId, purpose, text, subject) {
        const c = await this.prisma.customer.findFirst({
            where: { id: customerId, deletedAt: null },
            select: { email: true, phoneE164: true, preferredContact: true, name: true },
        });
        if (!c)
            return;
        const wantsPhone = c.preferredContact !== 'EMAIL' && !!c.phoneE164;
        if ((wantsPhone || !c.email) && c.phoneE164) {
            const out = await this.messenger.send({
                channel: 'SMS',
                to: c.phoneE164,
                body: text,
                meta: { customerId, purpose },
            });
            if (out === 'sent')
                return;
        }
        if (c.email)
            await this.mail
                .send({
                to: c.email,
                subject,
                text: `${c.name ? `Hi ${c.name},\n\n` : ''}${text}\n\n— CYG Finance`,
                fromName: 'CYG Finance',
            })
                .catch((err) => this.logger.warn(`${purpose} email to customer ${customerId} failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    baseUrl() {
        return (this.config.get('PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '') ||
            'https://cygfinance.com');
    }
    priceText = null;
    async priceLabel() {
        return (await this.priceText?.().catch(() => null)) ?? '$19.99';
    }
};
exports.SubscriptionService = SubscriptionService;
exports.SubscriptionService = SubscriptionService = SubscriptionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        customer_messenger_service_1.CustomerMessenger,
        mail_service_1.MailService])
], SubscriptionService);
//# sourceMappingURL=subscription.service.js.map