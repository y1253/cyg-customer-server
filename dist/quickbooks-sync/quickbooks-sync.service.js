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
var QuickBooksSyncService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuickBooksSyncService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const chart_of_accounts_1 = require("../bookkeeping/chart-of-accounts");
const tax_service_1 = require("../bookkeeping/tax.service");
const prisma_service_1 = require("../prisma/prisma.service");
const qbo_mapping_util_1 = require("./qbo-mapping.util");
const qbo_system_client_1 = require("./qbo-system.client");
const MAX_PER_RUN = 150;
const DEBOUNCE_MS = 2_000;
class StopRun extends Error {
}
const ROW_SELECT = {
    id: true,
    externalId: true,
    amount: true,
    postingDate: true,
    pendingDate: true,
    description: true,
    name: true,
    subNameId: true,
    offsetAccount: true,
    qboId: true,
    qboType: true,
    qboHash: true,
    statement: {
        select: {
            plaidAccount: {
                select: { id: true, kind: true, accountName: true, qboAccountId: true },
            },
        },
    },
    splits: {
        select: { amount: true, offsetAccount: true, name: true, subNameId: true },
    },
};
const day = (d) => d.toISOString().slice(0, 10);
let QuickBooksSyncService = QuickBooksSyncService_1 = class QuickBooksSyncService {
    prisma;
    client;
    tax;
    logger = new common_1.Logger(QuickBooksSyncService_1.name);
    running = new Map();
    again = new Set();
    timers = new Map();
    sweeping = false;
    constructor(prisma, client, tax) {
        this.prisma = prisma;
        this.client = client;
        this.tax = tax;
    }
    syncSoon(bookId) {
        clearTimeout(this.timers.get(bookId));
        this.timers.set(bookId, setTimeout(() => {
            this.timers.delete(bookId);
            void this.sync(bookId).catch(() => undefined);
        }, DEBOUNCE_MS));
    }
    async sweep() {
        if (this.sweeping)
            return;
        this.sweeping = true;
        try {
            const on = await this.prisma.quickBooksAccount.findMany({
                where: { updateQuickbooks: { not: null }, lastError: null },
                select: { companyId: true },
            });
            if (!on.length)
                return;
            const books = await this.prisma.book.findMany({
                where: {
                    companyId: { in: on.map((o) => o.companyId) },
                    deletedAt: null,
                },
                select: { id: true },
            });
            for (const b of books)
                await this.sync(b.id).catch(() => undefined);
        }
        finally {
            this.sweeping = false;
        }
    }
    async sync(bookId) {
        const current = this.running.get(bookId);
        if (current) {
            this.again.add(bookId);
            return current;
        }
        const run = (async () => {
            try {
                do {
                    this.again.delete(bookId);
                    await this.runBook(bookId);
                } while (this.again.has(bookId));
            }
            catch (err) {
                this.logger.warn(`book #${bookId}: QuickBooks push failed: ${String(err)}`);
            }
            finally {
                this.running.delete(bookId);
            }
        })();
        this.running.set(bookId, run);
        return run;
    }
    async forgetRows(where) {
        try {
            const rows = await this.prisma.bankTransaction.findMany({
                where: { ...where, qboId: { not: null }, companyId: { not: null } },
                select: { companyId: true, qboId: true, qboType: true },
            });
            for (const r of rows) {
                void this.client
                    .remove(r.companyId, r.qboType === 'Deposit' ? 'Deposit' : 'Purchase', r.qboId)
                    .catch((err) => this.logger.warn(`company #${r.companyId}: QuickBooks ${r.qboType} ${r.qboId} not removed: ${String(err)}`));
            }
        }
        catch (err) {
            this.logger.warn(`forgetRows failed: ${String(err)}`);
        }
    }
    async runBook(bookId) {
        const book = await this.prisma.book.findUnique({
            where: { id: bookId },
            select: { customerId: true, companyId: true, deletedAt: true },
        });
        if (!book?.companyId || book.deletedAt)
            return;
        const companyId = book.companyId;
        const qbo = await this.prisma.quickBooksAccount.findUnique({
            where: { companyId },
            select: { updateQuickbooks: true, lastError: true },
        });
        if (!qbo?.updateQuickbooks || qbo.lastError)
            return;
        const scope = { customerId: book.customerId, bookId, companyId };
        let writes = 0;
        try {
            writes += await this.removeOrphans(bookId, companyId);
            const rows = await this.prisma.bankTransaction.findMany({
                where: {
                    bookId,
                    splitOfId: null,
                    externalId: { not: null },
                    statement: { source: 'PLAID', status: 'DONE', deletedAt: null },
                    OR: [
                        { qboId: { not: null } },
                        { createdAt: { gte: qbo.updateQuickbooks } },
                    ],
                },
                select: ROW_SELECT,
                orderBy: { id: 'asc' },
            });
            const subNames = await this.subNamesOf(rows);
            let cache = null;
            for (const row of rows) {
                if (writes >= MAX_PER_RUN) {
                    this.again.add(bookId);
                    break;
                }
                const family = this.familyOf(row, subNames);
                if (!family)
                    continue;
                const hash = (0, qbo_mapping_util_1.familyHash)(family);
                if (row.qboId && row.qboHash === hash)
                    continue;
                cache ??= {
                    accounts: new Map(),
                    entities: new Map(),
                    types: await this.tax.typeContext(scope),
                };
                writes++;
                await this.push(companyId, row, family, hash, cache);
            }
        }
        catch (err) {
            if (err instanceof StopRun)
                return;
            throw err;
        }
        if (writes) {
            this.logger.log(`book #${bookId} (company #${companyId}): ${writes} QuickBooks write(s)`);
        }
    }
    async removeOrphans(bookId, companyId) {
        const rows = await this.prisma.bankTransaction.findMany({
            where: {
                bookId,
                qboId: { not: null },
                OR: [
                    { statement: { deletedAt: { not: null } } },
                    { statement: { status: { not: 'DONE' } } },
                ],
            },
            select: { id: true, qboId: true, qboType: true },
            take: MAX_PER_RUN,
        });
        for (const r of rows) {
            try {
                await this.client.remove(companyId, r.qboType === 'Deposit' ? 'Deposit' : 'Purchase', r.qboId);
            }
            catch (err) {
                this.stopOn(err);
                if (!this.isNotFound(err)) {
                    await this.fail(r.id, err);
                    continue;
                }
            }
            await this.prisma.bankTransaction.update({
                where: { id: r.id },
                data: { qboId: null, qboType: null, qboHash: null, qboSyncedAt: null, qboError: null },
            });
        }
        return rows.length;
    }
    async subNamesOf(rows) {
        const ids = new Set();
        for (const r of rows) {
            if (r.subNameId)
                ids.add(r.subNameId);
            for (const s of r.splits)
                if (s.subNameId)
                    ids.add(s.subNameId);
        }
        if (!ids.size)
            return new Map();
        const found = await this.prisma.subName.findMany({
            where: { id: { in: [...ids] } },
            select: { id: true, name: true },
        });
        return new Map(found.map((s) => [s.id, s.name]));
    }
    familyOf(row, subNames) {
        const account = row.statement.plaidAccount;
        const date = row.postingDate ?? row.pendingDate;
        const amount = Number(row.amount);
        if (!account || !date || !row.externalId || !amount)
            return null;
        const label = (subNameId, name) => (subNameId ? subNames.get(subNameId) : null) ??
            (name && name !== row.name ? name : null);
        return {
            rowId: row.id,
            externalId: row.externalId,
            date: day(date),
            cents: Math.round(amount * 100),
            name: row.name ? (0, qbo_mapping_util_1.qboText)(row.name) || null : null,
            description: row.description,
            kind: account.kind === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK',
            plaidAccountId: account.id,
            lines: (0, qbo_mapping_util_1.familyLines)({
                amount,
                category: row.offsetAccount,
                description: label(row.subNameId, null),
            }, row.splits.map((s) => ({
                amount: Number(s.amount),
                category: s.offsetAccount,
                description: label(s.subNameId, s.name),
            }))),
        };
    }
    async push(companyId, row, family, hash, cache) {
        const type = (0, qbo_mapping_util_1.qboTypeOf)(family);
        try {
            const refs = await this.refsFor(companyId, row, family, cache);
            const body = (0, qbo_mapping_util_1.qboBody)(family, refs);
            let id = row.qboId;
            if (id && row.qboType !== type) {
                await this.removeQuietly(companyId, row.qboType, id);
                id = null;
            }
            if (id) {
                try {
                    await this.client.update(companyId, type, id, body);
                }
                catch (err) {
                    this.stopOn(err);
                    if (!this.isNotFound(err))
                        throw err;
                    id = null;
                }
            }
            if (!id) {
                const res = await this.client.create(companyId, type, body);
                id = res[type]?.Id ?? null;
                if (!id)
                    throw new Error(`QuickBooks did not return the new ${type}'s id`);
            }
            await this.prisma.bankTransaction.update({
                where: { id: row.id },
                data: {
                    qboId: id,
                    qboType: type,
                    qboHash: hash,
                    qboSyncedAt: new Date(),
                    qboError: null,
                },
            });
        }
        catch (err) {
            this.stopOn(err);
            await this.fail(row.id, err);
        }
    }
    async refsFor(companyId, row, family, cache) {
        const moneyOut = family.cents < 0;
        const accountIds = new Map();
        for (const line of family.lines) {
            const name = (0, qbo_mapping_util_1.qboCategoryName)(line.category, moneyOut);
            if (!name || accountIds.has(name))
                continue;
            accountIds.set(name, await this.accountId(companyId, name, (0, chart_of_accounts_1.typeFor)(line.category, cache.types), cache));
        }
        return {
            bankAccountId: await this.bankAccountId(companyId, row),
            entity: family.name
                ? await this.entityFor(companyId, family.name, moneyOut, cache)
                : null,
            accountIds,
        };
    }
    async accountId(companyId, name, type, cache) {
        const known = cache.accounts.get(name);
        if (known)
            return known;
        const found = await this.findOne(companyId, 'Account', `Name = ${(0, qbo_mapping_util_1.qboQuote)(name)}`);
        const id = found ??
            (await this.created(companyId, 'Account', {
                Name: name,
                ...(0, qbo_mapping_util_1.qboAccountType)(name, type),
            }));
        cache.accounts.set(name, id);
        return id;
    }
    async bankAccountId(companyId, row) {
        const account = row.statement.plaidAccount;
        if (account.qboAccountId)
            return account.qboAccountId;
        const name = (0, qbo_mapping_util_1.qboText)(account.accountName) || `Bank account ${account.id}`;
        const id = (await this.findOne(companyId, 'Account', `Name = ${(0, qbo_mapping_util_1.qboQuote)(name)}`)) ??
            (await this.created(companyId, 'Account', {
                Name: name,
                AccountType: account.kind === 'CREDIT_CARD' ? 'Credit Card' : 'Bank',
            }));
        await this.prisma.plaidAccount.update({
            where: { id: account.id },
            data: { qboAccountId: id },
        });
        row.statement.plaidAccount.qboAccountId = id;
        return id;
    }
    async entityFor(companyId, name, moneyOut, cache) {
        const known = cache.entities.get(name);
        if (known)
            return known;
        for (const type of ['Vendor', 'Customer', 'Employee']) {
            const id = await this.findOne(companyId, type, `DisplayName = ${(0, qbo_mapping_util_1.qboQuote)(name)}`);
            if (id) {
                const entity = { id, type };
                cache.entities.set(name, entity);
                return entity;
            }
        }
        const type = moneyOut ? 'Vendor' : 'Customer';
        const entity = {
            id: await this.created(companyId, type, { DisplayName: name }),
            type,
        };
        cache.entities.set(name, entity);
        return entity;
    }
    async findOne(companyId, entity, where) {
        const res = await this.client.query(companyId, `select * from ${entity} where ${where} MAXRESULTS 1`);
        const list = res[entity];
        return list?.[0]?.Id ?? null;
    }
    async created(companyId, entity, body) {
        const res = await this.client.create(companyId, entity, body);
        const id = res[entity]?.Id;
        if (!id)
            throw new Error(`QuickBooks did not return the new ${entity}'s id`);
        this.logger.log(`company #${companyId}: created QuickBooks ${entity} ${id} (${JSON.stringify(body)})`);
        return id;
    }
    async removeQuietly(companyId, type, id) {
        try {
            await this.client.remove(companyId, type === 'Deposit' ? 'Deposit' : 'Purchase', id);
        }
        catch (err) {
            this.stopOn(err);
            if (!this.isNotFound(err))
                throw err;
        }
    }
    async fail(rowId, err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`row #${rowId}: QuickBooks push failed: ${message}`);
        await this.prisma.bankTransaction
            .update({ where: { id: rowId }, data: { qboError: message.slice(0, 2000) } })
            .catch(() => undefined);
    }
    stopOn(err) {
        if (err instanceof qbo_system_client_1.QboCallError &&
            (err.status === 409 || err.status === 401 || err.status === 0)) {
            this.logger.warn(`QuickBooks push stopped: ${err.message}`);
            throw new StopRun(err.message);
        }
        if (err instanceof qbo_system_client_1.QboCallError &&
            err.status === 404 &&
            /not connected/i.test(err.message)) {
            throw new StopRun(err.message);
        }
    }
    isNotFound(err) {
        return (err instanceof qbo_system_client_1.QboCallError &&
            /object not found|610|has been deleted|not found/i.test(err.message));
    }
};
exports.QuickBooksSyncService = QuickBooksSyncService;
__decorate([
    (0, schedule_1.Cron)('30 */2 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], QuickBooksSyncService.prototype, "sweep", null);
exports.QuickBooksSyncService = QuickBooksSyncService = QuickBooksSyncService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        qbo_system_client_1.QboSystemClient,
        tax_service_1.TaxService])
], QuickBooksSyncService);
//# sourceMappingURL=quickbooks-sync.service.js.map