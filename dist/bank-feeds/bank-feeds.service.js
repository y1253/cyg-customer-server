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
var BankFeedsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BankFeedsService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const scope_1 = require("../bookkeeping/scope");
const prisma_service_1 = require("../prisma/prisma.service");
const bank_feed_sync_service_1 = require("./bank-feed-sync.service");
const crypto_util_1 = require("./crypto.util");
const plaid_client_1 = require("./plaid.client");
const plaid_webhook_util_1 = require("./plaid-webhook.util");
const DAYS_REQUESTED = 730;
const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (d) => d.toISOString().slice(0, 10);
function viewOf(item, syncing) {
    return {
        id: item.id,
        institutionName: item.institutionName,
        status: item.status,
        error: item.error,
        historyDone: item.historyDone,
        lastSyncAt: item.lastSyncAt,
        createdAt: item.createdAt,
        setupAt: item.setupAt,
        syncing,
        newAccounts: item.newAccounts,
        earliestDate: isoDay(new Date(item.createdAt.getTime() - DAYS_REQUESTED * DAY_MS)),
        accounts: item.accounts
            .filter((a) => a.shared)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((a) => ({
            id: a.id,
            name: a.name,
            mask: a.mask,
            kind: a.kind,
            accountName: a.accountName,
            currency: a.currency,
            currentBalance: a.currentBalance === null ? null : Number(a.currentBalance),
            startDate: a.startDate ? isoDay(a.startDate) : null,
        })),
    };
}
let BankFeedsService = BankFeedsService_1 = class BankFeedsService {
    prisma;
    plaid;
    sync;
    config;
    logger = new common_1.Logger(BankFeedsService_1.name);
    keys = new Map();
    constructor(prisma, plaid, sync, config) {
        this.prisma = prisma;
        this.plaid = plaid;
        this.sync = sync;
        this.config = config;
    }
    get key() {
        return (this.config.get('ENCRYPTION_KEY')?.replace(/^"|"$/g, '').trim() ??
            '');
    }
    get enabled() {
        return this.plaid.configured && Boolean(this.key);
    }
    async list(scope) {
        const items = await this.prisma.plaidItem.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            include: { accounts: true },
            orderBy: { createdAt: 'asc' },
        });
        return items.map((i) => viewOf(i, this.sync.isRunning(i.id)));
    }
    async owned(scope, id) {
        const item = await this.prisma.plaidItem.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
        });
        if (!item)
            throw new common_1.NotFoundException('Bank connection not found');
        return item;
    }
    async view(id) {
        const item = await this.prisma.plaidItem.findUniqueOrThrow({
            where: { id },
            include: { accounts: true },
        });
        return viewOf(item, this.sync.isRunning(item.id));
    }
    async linkToken(scope, itemId, chooseAccounts = false) {
        const base = {
            client_name: 'CYG Finance',
            language: 'en',
            country_codes: this.plaid.countryCodes,
            user: { client_user_id: `customer-${scope.customerId}` },
            ...(this.plaid.webhookUrl ? { webhook: this.plaid.webhookUrl } : {}),
            ...(this.plaid.redirectUri
                ? { redirect_uri: this.plaid.redirectUri }
                : {}),
            ...(this.plaid.linkCustomization
                ? { link_customization_name: this.plaid.linkCustomization }
                : {}),
        };
        const body = itemId
            ? {
                ...base,
                access_token: (0, crypto_util_1.decrypt)((await this.owned(scope, itemId)).accessToken, this.key),
                ...(chooseAccounts
                    ? { update: { account_selection_enabled: true } }
                    : {}),
            }
            : {
                ...base,
                products: ['transactions'],
                transactions: { days_requested: DAYS_REQUESTED },
            };
        const res = await this.call('/link/token/create', body);
        return { linkToken: res.link_token };
    }
    async exchange(scope, publicToken) {
        const { access_token, item_id } = await this.call('/item/public_token/exchange', { public_token: publicToken });
        const { item, accounts } = await this.call('/accounts/get', { access_token });
        let institutionName = null;
        if (item.institution_id) {
            const inst = await this.call('/institutions/get_by_id', {
                institution_id: item.institution_id,
                country_codes: this.plaid.countryCodes,
            }).catch(() => null);
            institutionName = inst?.institution.name ?? null;
        }
        const masks = new Set(accounts.map((a) => a.mask).filter(Boolean));
        const twin = item.institution_id
            ? await this.prisma.plaidItem.findFirst({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    deletedAt: null,
                    institutionId: item.institution_id,
                    accounts: {
                        some: { shared: true, mask: { in: [...masks] } },
                    },
                },
            })
            : null;
        if (twin) {
            await this.plaid
                .call('/item/remove', { access_token })
                .catch(() => undefined);
            throw new common_1.ConflictException(`${institutionName ?? 'This bank'} is already connected here. Use "Sign in again" on it instead.`);
        }
        const saved = await this.prisma.plaidItem.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                itemId: item_id,
                accessToken: (0, crypto_util_1.encrypt)(access_token, this.key),
                institutionId: item.institution_id?.slice(0, 32) ?? null,
                institutionName: institutionName?.slice(0, 191) ?? null,
            },
        });
        this.logger.log(`item #${saved.id} connected (${institutionName ?? 'unknown bank'})`);
        await this.sync.saveAccounts(saved, accounts);
        this.sync.syncSoon(saved.id);
        return this.view(saved.id);
    }
    async reconnected(scope, id) {
        const item = await this.owned(scope, id);
        await this.prisma.plaidItem.update({
            where: { id: item.id },
            data: { status: 'ACTIVE', error: null, newAccounts: false },
        });
        try {
            const { accounts } = await this.plaid.call('/accounts/get', {
                access_token: (0, crypto_util_1.decrypt)(item.accessToken, this.key),
            });
            await this.sync.saveAccounts(item, accounts);
        }
        catch (err) {
            this.logger.warn(`item #${item.id} /accounts/get: ${String(err)}`);
        }
        this.sync.syncSoon(item.id);
        return this.view(item.id);
    }
    async refresh(scope, id) {
        const item = await this.owned(scope, id);
        if (item.status === 'LOGIN_REQUIRED') {
            throw new common_1.BadRequestException('Sign in to your bank again first');
        }
        const refreshNote = await this.sync.refreshNow(item.id);
        return { ...(await this.view(item.id)), refreshNote };
    }
    async setStartDates(scope, id, accounts) {
        const item = await this.owned(scope, id);
        const own = new Set((await this.prisma.plaidAccount.findMany({
            where: { plaidItemId: item.id, shared: true },
            select: { id: true },
        })).map((a) => a.id));
        const today = isoDay(new Date());
        for (const a of accounts) {
            if (!own.has(a.id))
                throw new common_1.NotFoundException('Account not found');
            if (a.startDate && a.startDate > today) {
                throw new common_1.BadRequestException('A start date cannot be in the future');
            }
        }
        for (const a of accounts) {
            await this.prisma.plaidAccount.update({
                where: { id: a.id },
                data: {
                    startDate: a.startDate ? new Date(`${a.startDate}T00:00:00Z`) : null,
                },
            });
        }
        if (!item.setupAt) {
            await this.prisma.plaidItem.update({
                where: { id: item.id },
                data: { setupAt: new Date() },
            });
        }
        this.sync.syncSoon(item.id);
        return this.view(item.id);
    }
    async remove(scope, id) {
        const item = await this.owned(scope, id);
        try {
            await this.plaid.call('/item/remove', {
                access_token: (0, crypto_util_1.decrypt)(item.accessToken, this.key),
            });
        }
        catch (err) {
            this.logger.warn(`item #${item.id} /item/remove: ${String(err)}`);
        }
        await this.prisma.plaidItem.update({
            where: { id: item.id },
            data: {
                status: 'REMOVED',
                deletedAt: new Date(),
                accessToken: '',
                cursor: null,
            },
        });
    }
    async call(path, body) {
        try {
            return await this.plaid.call(path, body);
        }
        catch (err) {
            if (err instanceof plaid_client_1.PlaidApiError) {
                this.logger.warn(`${path}: ${err.code} ${err.message}`);
                throw new common_1.BadRequestException(err.displayMessage ??
                    'We could not reach your bank through Plaid. Please try again.');
            }
            throw err;
        }
    }
    async verify(token, rawBody) {
        if (!token || !rawBody)
            return 'missing signature or body';
        const kid = (0, plaid_webhook_util_1.webhookKeyId)(token);
        if (!kid)
            return 'not an ES256 token';
        let key = this.keys.get(kid);
        if (!key) {
            const res = await this.plaid
                .call('/webhook_verification_key/get', { key_id: kid })
                .catch(() => null);
            if (!res)
                return 'unknown key';
            key = res.key;
            this.keys.set(kid, key);
        }
        return (0, plaid_webhook_util_1.verifyPlaidWebhook)(token, key, rawBody);
    }
    async handle(body) {
        if (!body.item_id)
            return;
        const item = await this.prisma.plaidItem.findUnique({
            where: { itemId: body.item_id },
        });
        if (!item || item.deletedAt)
            return;
        const type = body.webhook_type;
        const code = body.webhook_code;
        this.logger.log(`webhook ${type}/${code} for item #${item.id}`);
        if (type === 'TRANSACTIONS') {
            if (body.historical_update_complete && !item.historyDone) {
                await this.prisma.plaidItem.update({
                    where: { id: item.id },
                    data: { historyDone: true },
                });
            }
            this.sync.syncSoon(item.id);
            return;
        }
        if (type !== 'ITEM')
            return;
        if (code === 'NEW_ACCOUNTS_AVAILABLE') {
            await this.prisma.plaidItem.update({
                where: { id: item.id },
                data: { newAccounts: true },
            });
            return;
        }
        if (code === 'LOGIN_REPAIRED') {
            await this.prisma.plaidItem.update({
                where: { id: item.id },
                data: { status: 'ACTIVE', error: null },
            });
            this.sync.syncSoon(item.id);
            return;
        }
        const reason = (fallback) => (body.error?.display_message ||
            body.error?.error_message ||
            fallback).slice(0, 2000);
        if (code === 'PENDING_EXPIRATION' || code === 'PENDING_DISCONNECT') {
            await this.prisma.plaidItem.update({
                where: { id: item.id },
                data: {
                    status: 'LOGIN_REQUIRED',
                    error: reason('Your bank asks you to sign in again.'),
                },
            });
        }
        else if (code === 'USER_PERMISSION_REVOKED' ||
            code === 'USER_ACCOUNT_REVOKED') {
            await this.prisma.plaidItem.update({
                where: { id: item.id },
                data: {
                    status: 'ERROR',
                    error: 'Access was turned off at your bank. Connect it again to resume.',
                },
            });
        }
        else if (code === 'ERROR') {
            const login = body.error?.error_code === 'ITEM_LOGIN_REQUIRED';
            await this.prisma.plaidItem.update({
                where: { id: item.id },
                data: {
                    status: login ? 'LOGIN_REQUIRED' : 'ERROR',
                    error: reason('Your bank connection stopped working.'),
                },
            });
        }
    }
};
exports.BankFeedsService = BankFeedsService;
exports.BankFeedsService = BankFeedsService = BankFeedsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        plaid_client_1.PlaidClient,
        bank_feed_sync_service_1.BankFeedSyncService,
        config_1.ConfigService])
], BankFeedsService);
//# sourceMappingURL=bank-feeds.service.js.map