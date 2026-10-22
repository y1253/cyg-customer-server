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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var BankFeedSyncService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BankFeedSyncService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const client_1 = require("@prisma/client");
const rules_service_1 = require("../assistant/rules.service");
const account_identity_util_1 = require("../bookkeeping/account-identity.util");
const chart_of_accounts_1 = require("../bookkeeping/chart-of-accounts");
const ledger_util_1 = require("../bookkeeping/ledger.util");
const name_memory_service_1 = require("../bookkeeping/name-memory.service");
const name_memory_util_1 = require("../bookkeeping/name-memory.util");
const scope_1 = require("../bookkeeping/scope");
const prisma_service_1 = require("../prisma/prisma.service");
const bank_feed_util_1 = require("./bank-feed.util");
const bank_row_categorizer_1 = require("./bank-row-categorizer");
const crypto_util_1 = require("./crypto.util");
const plaid_client_1 = require("./plaid.client");
const LOGIN_CODES = new Set([
    'ITEM_LOGIN_REQUIRED',
    'PENDING_EXPIRATION',
    'PENDING_DISCONNECT',
    'INVALID_CREDENTIALS',
    'INVALID_MFA',
    'ITEM_LOCKED',
    'USER_SETUP_REQUIRED',
    'MFA_NOT_SUPPORTED',
    'NO_ACCOUNTS',
]);
const SYNC_PAGE = 500;
const HISTORY_GIVE_UP_MS = 24 * 60 * 60 * 1000;
const MAX_SYNC_RESTARTS = 3;
const day = (d) => d.toISOString().slice(0, 10);
const money = (cents) => cents === null ? null : (cents / 100).toFixed(2);
let BankFeedSyncService = BankFeedSyncService_1 = class BankFeedSyncService {
    prisma;
    plaid;
    config;
    names;
    categorizer;
    rules;
    logger = new common_1.Logger(BankFeedSyncService_1.name);
    running = new Map();
    again = new Set();
    lastRefreshAt = new Map();
    noteLoggedOn = new Map();
    refreshUnsupportedLogged = false;
    constructor(prisma, plaid, config, names, categorizer, rules) {
        this.prisma = prisma;
        this.plaid = plaid;
        this.config = config;
        this.names = names;
        this.categorizer = categorizer;
        this.rules = rules;
    }
    get key() {
        return (this.config.get('ENCRYPTION_KEY')?.replace(/^"|"$/g, '').trim() ??
            '');
    }
    syncSoon(itemId) {
        void this.sync(itemId).catch(() => undefined);
    }
    async sync(itemId) {
        const current = this.running.get(itemId);
        if (current) {
            this.again.add(itemId);
            return current;
        }
        const run = (async () => {
            try {
                do {
                    this.again.delete(itemId);
                    await this.runSync(itemId);
                } while (this.again.has(itemId));
            }
            finally {
                this.running.delete(itemId);
            }
        })();
        this.running.set(itemId, run);
        return run;
    }
    isRunning(itemId) {
        return this.running.has(itemId);
    }
    async syncLoading() {
        if (!this.plaid.configured)
            return;
        const items = await this.prisma.plaidItem.findMany({
            where: { deletedAt: null, status: 'ACTIVE', historyDone: false },
            select: { id: true },
        });
        for (const { id } of items) {
            if (this.running.has(id))
                continue;
            await this.sync(id).catch(() => undefined);
        }
    }
    async syncAll() {
        if (!this.plaid.configured)
            return;
        const items = await this.prisma.plaidItem.findMany({
            where: { deletedAt: null, status: 'ACTIVE' },
            select: { id: true },
        });
        for (const { id } of items)
            await this.sync(id).catch(() => undefined);
    }
    async rebuildAll() {
        const items = await this.prisma.plaidItem.findMany({
            where: { deletedAt: null },
            select: { id: true },
        });
        for (const { id } of items) {
            if (this.running.has(id))
                continue;
            await this.rebuildItem(id).catch((err) => this.logger.warn(`rebuild of item #${id} failed: ${String(err)}`));
        }
    }
    async runSync(itemId) {
        const item = await this.prisma.plaidItem.findUnique({
            where: { id: itemId },
        });
        if (!item || item.deletedAt || item.status === 'REMOVED')
            return;
        const started = Date.now();
        try {
            const accessToken = (0, crypto_util_1.decrypt)(item.accessToken, this.key);
            const { accounts } = await this.plaid.call('/accounts/get', { access_token: accessToken });
            const byPlaidId = await this.saveAccounts(item, accounts);
            const { added, modified, removed, cursor, updateStatus } = await this.fetchChanges(accessToken, item.cursor);
            await this.saveTransactions(byPlaidId, added, modified, removed);
            let note = null;
            if (!item.historyDone && updateStatus === 'NOT_READY') {
                const bank = await this.bankStatus(item, accessToken);
                note = bank
                    ? (0, bank_feed_util_1.bankDelayNote)(item.institutionName, bank.updates, bank.health)
                    : null;
                this.logNote(item, note, bank);
                const failedWithoutSuccess = Boolean(bank?.updates?.last_failed_update &&
                    !bank.updates.last_successful_update);
                const decision = (0, bank_feed_util_1.shouldRequestRefresh)({
                    now: new Date(),
                    lastRefreshAt: this.lastRefreshAt.get(item.id) ?? null,
                    institutionId: item.institutionId,
                    failedWithoutSuccess,
                    manual: false,
                });
                if (decision === 'ok') {
                    await this.requestRefresh(item, accessToken, 'auto');
                }
            }
            const historyDone = item.historyDone ||
                updateStatus === 'HISTORICAL_UPDATE_COMPLETE' ||
                (!note && Date.now() - item.createdAt.getTime() > HISTORY_GIVE_UP_MS);
            await this.prisma.plaidItem.update({
                where: { id: item.id },
                data: {
                    cursor,
                    lastSyncAt: new Date(),
                    status: 'ACTIVE',
                    error: note,
                    historyDone,
                },
            });
            this.logger.log(`item #${item.id} synced: +${added.length} ~${modified.length} -${removed.length} in ${Date.now() - started}ms`);
        }
        catch (err) {
            await this.recordError(item, err);
        }
        try {
            await this.rebuildItem(item.id);
        }
        catch (err) {
            this.logger.warn(`rebuild of item #${item.id} failed: ${String(err)}`);
        }
    }
    async refreshNow(itemId) {
        const item = await this.prisma.plaidItem.findUnique({
            where: { id: itemId },
        });
        if (item && !item.deletedAt && item.status === 'ACTIVE') {
            const decision = (0, bank_feed_util_1.shouldRequestRefresh)({
                now: new Date(),
                lastRefreshAt: this.lastRefreshAt.get(item.id) ?? null,
                institutionId: item.institutionId,
                failedWithoutSuccess: false,
                manual: true,
            });
            if (decision === 'outside-window') {
                this.syncSoon(item.id);
                return (0, bank_feed_util_1.refreshWindowNote)(item.institutionName, item.institutionId);
            }
            if (decision === 'ok') {
                try {
                    await this.requestRefresh(item, (0, crypto_util_1.decrypt)(item.accessToken, this.key), 'manual');
                }
                catch (err) {
                    this.logger.warn(`item #${item.id} refresh skipped: ${String(err)}`);
                }
            }
        }
        this.syncSoon(itemId);
        return null;
    }
    async requestRefresh(item, accessToken, why) {
        this.lastRefreshAt.set(item.id, new Date());
        try {
            await this.plaid.call('/transactions/refresh', {
                access_token: accessToken,
            });
            this.logger.log(`item #${item.id} refresh requested (${why})`);
        }
        catch (err) {
            const code = err instanceof plaid_client_1.PlaidApiError ? err.code : null;
            if (code === 'PRODUCTS_NOT_SUPPORTED' || code === 'INVALID_PRODUCT') {
                if (!this.refreshUnsupportedLogged) {
                    this.refreshUnsupportedLogged = true;
                    this.logger.warn(`item #${item.id} refresh refused: ${code} — enable Transactions Refresh ` +
                        '(transactions_refresh) for this Plaid account in the Plaid dashboard');
                }
                return;
            }
            this.logger.warn(`item #${item.id} refresh refused (${why}): ${code ?? String(err)}`);
        }
    }
    logNote(item, note, bank) {
        if (!note) {
            this.noteLoggedOn.delete(item.id);
            return;
        }
        const today = (0, bank_feed_util_1.isoDay)();
        if (note === item.error && this.noteLoggedOn.get(item.id) === today)
            return;
        this.noteLoggedOn.set(item.id, today);
        this.logger.log(`item #${item.id} waiting on the bank: ${note} ` +
            `(Plaid last_failed_update=${bank?.updates?.last_failed_update ?? '-'}, ` +
            `last_successful_update=${bank?.updates?.last_successful_update ?? '-'}, ` +
            `bank updates=${bank?.health?.updates ?? '-'}, open incidents=${bank?.health?.openIncidents ?? '-'})`);
    }
    async bankStatus(item, accessToken) {
        try {
            const { item: info, status } = await this.plaid.call('/item/get', { access_token: accessToken });
            const updates = status?.transactions ?? null;
            if (!updates?.last_failed_update || updates.last_successful_update) {
                return { updates, health: null };
            }
            const institutionId = info.institution_id ?? item.institutionId;
            const health = institutionId
                ? await this.plaid
                    .call('/institutions/get_by_id', {
                    institution_id: institutionId,
                    country_codes: this.plaid.countryCodes,
                    options: { include_status: true },
                })
                    .then(({ institution }) => ({
                    updates: institution?.status?.transactions_updates?.status,
                    openIncidents: (institution?.status?.health_incidents ?? []).filter((h) => !h.end_date).length,
                }))
                    .catch(() => null)
                : null;
            return { updates, health };
        }
        catch {
            return null;
        }
    }
    async recordError(item, err) {
        const plaidErr = err instanceof plaid_client_1.PlaidApiError ? err : null;
        const status = plaidErr && LOGIN_CODES.has(plaidErr.code) ? 'LOGIN_REQUIRED' : 'ERROR';
        const message = plaidErr
            ? `${plaidErr.code}: ${plaidErr.displayMessage ?? plaidErr.message}`
            : err instanceof Error
                ? err.message
                : String(err);
        this.logger.warn(`item #${item.id} sync failed (${status}): ${message}`);
        await this.prisma.plaidItem
            .update({
            where: { id: item.id },
            data: { status, error: message.slice(0, 2000) },
        })
            .catch(() => undefined);
    }
    async fetchChanges(accessToken, start) {
        for (let attempt = 0;; attempt++) {
            const added = [];
            const modified = [];
            const removed = [];
            let cursor = start;
            let updateStatus = null;
            try {
                for (;;) {
                    const page = await this.plaid.call('/transactions/sync', {
                        access_token: accessToken,
                        ...(cursor ? { cursor } : {}),
                        count: SYNC_PAGE,
                    });
                    added.push(...page.added);
                    modified.push(...page.modified);
                    removed.push(...page.removed.map((r) => r.transaction_id));
                    cursor = page.next_cursor;
                    updateStatus = page.transactions_update_status ?? updateStatus;
                    if (!page.has_more)
                        break;
                }
                return { added, modified, removed, cursor, updateStatus };
            }
            catch (err) {
                const restart = err instanceof plaid_client_1.PlaidApiError &&
                    err.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' &&
                    attempt < MAX_SYNC_RESTARTS;
                if (!restart)
                    throw err;
            }
        }
    }
    async saveAccounts(item, accounts) {
        const scope = (0, scope_1.scopeOf)(item);
        const existing = await this.prisma.plaidAccount.findMany({
            where: { accountId: { in: accounts.map((a) => a.account_id) } },
        });
        const byId = new Map(existing.map((a) => [a.accountId, a]));
        const now = new Date();
        let known = null;
        for (const a of accounts) {
            const kind = (0, bank_feed_util_1.kindOfPlaidType)(a.type);
            const currency = (a.balances.iso_currency_code ?? '').slice(0, 3) || null;
            const balance = a.balances.current === null
                ? null
                : (Math.round(a.balances.current * 100) / 100).toFixed(2);
            const common = {
                name: a.name.slice(0, 191),
                officialName: a.official_name?.slice(0, 191) ?? null,
                mask: a.mask?.slice(0, 8) ?? null,
                type: a.type.slice(0, 20),
                subtype: a.subtype?.slice(0, 40) ?? null,
                currency,
                currentBalance: balance,
                balanceAt: now,
                shared: true,
            };
            const found = byId.get(a.account_id);
            if (found) {
                byId.set(a.account_id, await this.prisma.plaidAccount.update({
                    where: { id: found.id },
                    data: common,
                }));
                continue;
            }
            known ??= await this.knownAccounts(scope);
            const accountName = (0, account_identity_util_1.canonicalAccountName)({
                accountName: (0, bank_feed_util_1.defaultAccountName)(item.institutionName, a),
                accountNumber: a.mask,
                accountKind: kind,
            }, known) ?? (0, bank_feed_util_1.defaultAccountName)(item.institutionName, a);
            known.push({ name: accountName, kind });
            byId.set(a.account_id, await this.prisma.plaidAccount.create({
                data: {
                    ...common,
                    plaidItemId: item.id,
                    accountId: a.account_id,
                    accountName: accountName.slice(0, 191),
                    kind,
                    startDate: item.setupAt ? new Date(`${day(now)}T00:00:00Z`) : null,
                },
            }));
        }
        if (accounts.length) {
            await this.prisma.plaidAccount.updateMany({
                where: {
                    plaidItemId: item.id,
                    shared: true,
                    accountId: { notIn: accounts.map((a) => a.account_id) },
                },
                data: { shared: false },
            });
        }
        return byId;
    }
    async knownAccounts(scope) {
        const [statements, feeds] = await Promise.all([
            this.prisma.bankStatement.findMany({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    deletedAt: null,
                    accountName: { not: null },
                },
                distinct: ['accountName', 'accountKind'],
                select: { accountName: true, accountKind: true },
            }),
            this.prisma.plaidAccount.findMany({
                where: { item: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null } },
                select: { accountName: true, kind: true },
            }),
        ]);
        return [
            ...statements.map((s) => ({ name: s.accountName, kind: s.accountKind })),
            ...feeds.map((f) => ({ name: f.accountName, kind: f.kind })),
        ];
    }
    async saveTransactions(accounts, added, modified, removed) {
        const rows = [...added, ...modified].filter((t) => accounts.has(t.account_id));
        const dataOf = (t) => ({
            plaidAccountId: accounts.get(t.account_id).id,
            date: new Date(`${t.date}T00:00:00Z`),
            authorizedDate: t.authorized_date
                ? new Date(`${t.authorized_date}T00:00:00Z`)
                : null,
            name: (t.name || '(no description)').slice(0, 512),
            merchantName: t.merchant_name?.slice(0, 191) ?? null,
            amount: (Math.round(t.amount * 100) / 100).toFixed(2),
            currency: (t.iso_currency_code ?? '').slice(0, 3) || null,
            category: t.personal_finance_category?.detailed?.slice(0, 80) ?? null,
            pending: t.pending,
            removedAt: null,
        });
        for (let i = 0; i < rows.length; i += 500) {
            const batch = rows.slice(i, i + 500);
            const have = new Set((await this.prisma.plaidTransaction.findMany({
                where: {
                    transactionId: { in: batch.map((t) => t.transaction_id) },
                },
                select: { transactionId: true },
            })).map((r) => r.transactionId));
            const fresh = batch.filter((t) => !have.has(t.transaction_id));
            if (fresh.length) {
                await this.prisma.plaidTransaction.createMany({
                    data: fresh.map((t) => ({
                        transactionId: t.transaction_id,
                        ...dataOf(t),
                    })),
                    skipDuplicates: true,
                });
            }
            for (const t of batch.filter((b) => have.has(b.transaction_id))) {
                await this.prisma.plaidTransaction.update({
                    where: { transactionId: t.transaction_id },
                    data: dataOf(t),
                });
            }
        }
        if (removed.length) {
            await this.prisma.plaidTransaction.updateMany({
                where: { transactionId: { in: [...removed] } },
                data: { removedAt: new Date() },
            });
        }
    }
    async rebuildItem(itemId) {
        const item = await this.prisma.plaidItem.findUnique({
            where: { id: itemId },
            include: { accounts: true },
        });
        if (!item || !item.setupAt)
            return;
        for (const account of item.accounts) {
            if (account.shared)
                await this.rebuildAccount(item, account);
            else
                await this.dropAccount(account);
        }
    }
    async dropAccount(account) {
        const { count } = await this.prisma.bankStatement.deleteMany({
            where: { plaidAccountId: account.id, deletedAt: null },
        });
        if (count) {
            this.logger.log(`account #${account.id}: removed ${count} feed month(s), no longer shared`);
        }
    }
    async rebuildAccount(item, account) {
        const scope = (0, scope_1.scopeOf)(item);
        const kind = account.kind === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK';
        const txns = await this.prisma.plaidTransaction.findMany({
            where: { plaidAccountId: account.id, pending: false, removedAt: null },
        });
        const byId = new Map(txns.map((t) => [t.transactionId, t]));
        const uploads = await this.prisma.bankStatement.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                deletedAt: null,
                source: { not: 'PLAID' },
                accountName: account.accountName,
                status: { in: [client_1.StatementStatus.DONE, client_1.StatementStatus.NEEDS_REVIEW] },
                periodStart: { not: null },
                periodEnd: { not: null },
            },
            select: { periodStart: true, periodEnd: true },
        });
        const plans = (0, bank_feed_util_1.planMonths)({
            kind,
            currentCents: account.currentBalance === null
                ? null
                : Math.round(Number(account.currentBalance) * 100),
            today: (0, bank_feed_util_1.isoDay)(account.balanceAt ?? new Date()),
            txns: txns.map((t) => ({
                id: t.transactionId,
                date: day(t.date),
                cents: (0, bank_feed_util_1.feedCents)(t.amount.toString()),
            })),
            covered: uploads.map((u) => ({
                start: day(u.periodStart),
                end: day(u.periodEnd),
            })),
            startDate: account.startDate ? day(account.startDate) : null,
        });
        const existing = await this.prisma.bankStatement.findMany({
            where: { plaidAccountId: account.id },
        });
        const byMonth = new Map();
        for (const s of existing) {
            if (!s.periodStart)
                continue;
            const m = (0, bank_feed_util_1.monthOf)(day(s.periodStart));
            if (!byMonth.has(m) || s.deletedAt)
                byMonth.set(m, s);
        }
        const planned = new Set(plans.map((p) => (0, bank_feed_util_1.monthOf)(p.periodStart)));
        const stale = existing.filter((s) => !s.deletedAt &&
            (!s.periodStart || !planned.has((0, bank_feed_util_1.monthOf)(day(s.periodStart)))));
        if (stale.length) {
            await this.prisma.bankStatement.deleteMany({
                where: { id: { in: stale.map((s) => s.id) } },
            });
            this.logger.log(`account #${account.id}: removed ${stale.length} feed month(s) an upload now covers`);
        }
        const live = [];
        for (const plan of plans) {
            const found = byMonth.get((0, bank_feed_util_1.monthOf)(plan.periodStart));
            if (found?.deletedAt)
                continue;
            const fields = {
                periodStart: new Date(`${plan.periodStart}T00:00:00Z`),
                periodEnd: new Date(`${plan.periodEnd}T00:00:00Z`),
                openingBalance: money(plan.openingCents),
                closingBalance: money(plan.closingCents),
                transactionCount: plan.txnIds.length,
                currency: account.currency,
            };
            let statement;
            if (!found) {
                statement = await this.prisma.bankStatement.create({
                    data: {
                        ...(0, scope_1.scopeWhere)(scope),
                        ...fields,
                        filename: `${account.accountName} · ${(0, bank_feed_util_1.monthLabel)(plan.periodStart)}`.slice(0, 191),
                        storageKey: '',
                        sizeBytes: 0,
                        source: 'PLAID',
                        status: client_1.StatementStatus.DONE,
                        verification: 'UNVERIFIED',
                        accountName: account.accountName,
                        accountKind: kind,
                        bankName: item.institutionName,
                        plaidAccountId: account.id,
                        processedAt: new Date(),
                    },
                });
            }
            else if (changed(found, fields)) {
                statement = await this.prisma.bankStatement.update({
                    where: { id: found.id },
                    data: { ...fields, processedAt: new Date() },
                });
            }
            else {
                statement = found;
            }
            live.push({ statement, plan });
        }
        await this.syncRows(scope, item, live, byId);
    }
    async syncRows(scope, item, live, txns) {
        const desired = new Map();
        for (const { statement, plan } of live) {
            plan.txnIds.forEach((id, position) => desired.set(id, { statement, position, txn: txns.get(id) }));
        }
        const statementIds = live.map((l) => l.statement.id);
        const existing = await this.prisma.bankTransaction.findMany({
            where: {
                externalId: { not: null },
                OR: [
                    { statementId: { in: statementIds } },
                    { externalId: { in: [...desired.keys()] } },
                ],
            },
            select: {
                id: true,
                externalId: true,
                statementId: true,
                position: true,
                postingDate: true,
                pendingDate: true,
                description: true,
                amount: true,
                offsetAccount: true,
            },
        });
        const gone = existing.filter((r) => !desired.has(r.externalId));
        if (gone.length) {
            await this.prisma.bankTransaction.deleteMany({
                where: { id: { in: gone.map((r) => r.id) } },
            });
        }
        const seen = new Set();
        for (const row of existing) {
            const want = desired.get(row.externalId);
            if (!want)
                continue;
            seen.add(row.externalId);
            const t = want.txn;
            const amount = ((0, bank_feed_util_1.feedCents)(t.amount.toString()) / 100).toFixed(2);
            const bank = want.statement.accountName ?? '';
            const next = {
                statementId: want.statement.id,
                position: want.position,
                postingDate: t.date,
                pendingDate: t.authorizedDate,
                description: t.name.slice(0, 512),
                amount,
            };
            const same = row.statementId === next.statementId &&
                row.position === next.position &&
                sameDay(row.postingDate, next.postingDate) &&
                sameDay(row.pendingDate, next.pendingDate) &&
                row.description === next.description &&
                Number(row.amount).toFixed(2) === amount;
            if (same)
                continue;
            await this.prisma.bankTransaction.updateMany({
                where: { id: row.id },
                data: {
                    ...next,
                    ...(0, ledger_util_1.doubleEntry)(Number(amount), bank, row.offsetAccount),
                },
            });
            await this.prisma.bankTransaction.updateMany({
                where: { splitOfId: row.id },
                data: {
                    statementId: next.statementId,
                    position: next.position,
                    postingDate: next.postingDate,
                    pendingDate: next.pendingDate,
                },
            });
        }
        const fresh = [...desired.entries()].filter(([id]) => !seen.has(id));
        if (fresh.length)
            await this.insertRows(scope, item, fresh.map(([, v]) => v));
    }
    async insertRows(scope, item, rows) {
        const lines = rows.map(({ txn }) => ({
            pendingDate: txn.authorizedDate ? day(txn.authorizedDate) : null,
            postingDate: day(txn.date),
            description: txn.name,
            name: txn.merchantName,
            amount: (0, bank_feed_util_1.feedCents)(txn.amount.toString()) / 100,
            balanceAfter: null,
            offsetAccount: chart_of_accounts_1.UNCATEGORIZED,
        }));
        const guessed = await this.guess(scope, item.institutionName, lines, rows.map((r) => r.txn));
        const { lines: resolved, customAccounts } = await this.names.resolveStatement(scope, guessed, item.institutionName);
        const data = rows.map(({ statement, position, txn }, i) => {
            const [row] = (0, ledger_util_1.buildLedgerRows)([resolved[i]], statement.accountName ?? '', customAccounts);
            return {
                ...row,
                position,
                statementId: statement.id,
                externalId: txn.transactionId,
                ...(0, scope_1.scopeWhere)(scope),
            };
        });
        for (let i = 0; i < data.length; i += 500) {
            await this.prisma.bankTransaction.createMany({
                data: data.slice(i, i + 500),
                skipDuplicates: true,
            });
        }
        this.logger.log(`item #${item.id}: ${data.length} new ledger row(s)`);
    }
    async guess(scope, bankName, lines, txns) {
        if (!this.categorizer.configured || !lines.length)
            return lines;
        try {
            const ctx = {
                ...(await this.names.contextFor(scope, lines.map((l) => l.description), lines.map((l) => l.name))),
                bankName,
            };
            const unknown = lines
                .map((l, i) => ({ l, i, r: (0, name_memory_util_1.resolveRow)(l, ctx) }))
                .filter(({ r }) => r.category === chart_of_accounts_1.UNCATEGORIZED || !r.name);
            if (!unknown.length)
                return lines;
            const rules = (await this.rules?.promptBlock(scope, 'CATEGORY', 'BANK_FEED_CATEGORIZER')) ?? '';
            const answers = await this.categorizer.categorize(unknown.map(({ l, i }) => ({
                key: String(i),
                description: l.description,
                merchant: l.name ?? null,
                amount: l.amount,
                hint: txns[i].category,
            })), rules);
            return lines.map((l, i) => {
                const a = answers.get(String(i));
                return a
                    ? { ...l, name: l.name || a.name, offsetAccount: a.category }
                    : l;
            });
        }
        catch (err) {
            this.logger.warn(`categorizing feed rows failed, filing them Uncategorized: ${String(err)}`);
            return lines;
        }
    }
};
exports.BankFeedSyncService = BankFeedSyncService;
__decorate([
    (0, schedule_1.Cron)('*/5 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BankFeedSyncService.prototype, "syncLoading", null);
__decorate([
    (0, schedule_1.Cron)('17 */6 * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BankFeedSyncService.prototype, "syncAll", null);
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_HOUR),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BankFeedSyncService.prototype, "rebuildAll", null);
exports.BankFeedSyncService = BankFeedSyncService = BankFeedSyncService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(5, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        plaid_client_1.PlaidClient,
        config_1.ConfigService,
        name_memory_service_1.NameMemoryService,
        bank_row_categorizer_1.BankRowCategorizer,
        rules_service_1.RulesService])
], BankFeedSyncService);
function sameDay(a, b) {
    return (a === null && b === null) || (!!a && !!b && day(a) === day(b));
}
function changed(s, f) {
    const dec = (v) => v === null || v === undefined ? null : Number(v).toFixed(2);
    return (!sameDay(s.periodStart, f.periodStart) ||
        !sameDay(s.periodEnd, f.periodEnd) ||
        dec(s.openingBalance) !== f.openingBalance ||
        dec(s.closingBalance) !== f.closingBalance ||
        s.transactionCount !== f.transactionCount ||
        s.currency !== f.currency);
}
//# sourceMappingURL=bank-feed-sync.service.js.map