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
const scope_1 = require("../bookkeeping/scope");
const tax_service_1 = require("../bookkeeping/tax.service");
const prisma_service_1 = require("../prisma/prisma.service");
const qbo_mapping_util_1 = require("./qbo-mapping.util");
const qbo_bank_match_util_1 = require("./qbo-bank-match.util");
const qbo_system_client_1 = require("./qbo-system.client");
const MAX_PER_RUN = 150;
const MERGE_PAGE = 200;
const DEBOUNCE_MS = 2_000;
const MATCH_DAYS = 90;
const MATCH_PAGE = 1000;
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
        select: {
            id: true,
            amount: true,
            offsetAccount: true,
            name: true,
            subNameId: true,
        },
    },
};
const noLinkedAnswers = () => ({
    classOf: new Map(),
    fieldsOf: new Map(),
    locationOf: new Map(),
    customerOf: new Map(),
});
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
    async pushedPayee(scope, matchKey) {
        try {
            const key = matchKey.trim().toLowerCase();
            if (!key || !scope.companyId)
                return null;
            const rule = await this.prisma.customerNameRule.findFirst({
                where: { ...(0, scope_1.scopeWhere)(scope), matchType: 'NAME', matchKey: key },
                select: { name: true },
            });
            const names = [key, ...(rule?.name ? [rule.name] : [])];
            const row = await this.prisma.bankTransaction.findFirst({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    splitOfId: null,
                    qboId: { not: null },
                    name: { in: names },
                },
                select: { name: true },
                orderBy: { qboSyncedAt: 'desc' },
            });
            return row?.name ?? null;
        }
        catch (err) {
            this.logger.warn(`pushedPayee failed: ${String(err)}`);
            return null;
        }
    }
    renamePayee(scope, from, to) {
        if (!from || !to || !scope.companyId)
            return;
        if (from.trim() === to.trim())
            return;
        void this.renameNow(scope.bookId, scope.companyId, from, to)
            .catch((err) => this.logger.warn(`book #${scope.bookId}: QuickBooks rename "${from}" → "${to}" failed: ${String(err)}`))
            .finally(() => this.syncSoon(scope.bookId));
    }
    async renameNow(bookId, companyId, from, to) {
        const qbo = await this.prisma.quickBooksAccount.findUnique({
            where: { companyId },
            select: { updateQuickbooks: true, lastError: true },
        });
        if (!qbo?.updateQuickbooks || qbo.lastError)
            return;
        for (const mixed of [false, true]) {
            const oldName = (0, qbo_mapping_util_1.qboPayeeName)(from, mixed);
            const newName = (0, qbo_mapping_util_1.qboPayeeName)(to, mixed);
            if (oldName === newName)
                continue;
            const found = await this.findEntity(companyId, oldName);
            if (!found)
                continue;
            const taken = await this.findEntity(companyId, newName);
            if (taken && taken.id !== found.id) {
                this.logger.log(`book #${bookId}: QuickBooks already has "${newName}" — the rows move onto it`);
                continue;
            }
            await this.client.update(companyId, found.type, found.id, {
                DisplayName: newName,
            });
            this.logger.log(`book #${bookId}: renamed QuickBooks ${found.type} ${found.id} "${oldName}" → "${newName}"`);
        }
    }
    async findEntity(companyId, name) {
        for (const type of ['Vendor', 'Customer', 'Employee']) {
            const id = await this.findOne(companyId, type, `DisplayName = ${(0, qbo_mapping_util_1.qboQuote)(name)}`);
            if (id)
                return { id, type };
        }
        return null;
    }
    mergePayee(scope, from, into) {
        if (!scope.companyId)
            return;
        const companyId = scope.companyId;
        if (!from ||
            !into ||
            from.trim().toLowerCase() === into.trim().toLowerCase()) {
            this.syncSoon(scope.bookId);
            return;
        }
        void this.mergeNow(scope.bookId, companyId, from, into)
            .catch((err) => this.logger.warn(`book #${scope.bookId}: QuickBooks merge "${from}" → "${into}" failed: ${String(err)}`))
            .finally(() => this.syncSoon(scope.bookId));
    }
    async mergeNow(bookId, companyId, from, into) {
        const qbo = await this.prisma.quickBooksAccount.findUnique({
            where: { companyId },
            select: { updateQuickbooks: true, lastError: true },
        });
        if (!qbo?.updateQuickbooks || qbo.lastError)
            return;
        for (const mixed of [false, true]) {
            const oldName = (0, qbo_mapping_util_1.qboPayeeName)(from, mixed);
            const found = await this.findEntity(companyId, oldName);
            if (!found)
                continue;
            const target = (await this.findEntity(companyId, (0, qbo_mapping_util_1.qboPayeeName)(into, mixed))) ??
                (await this.findEntity(companyId, (0, qbo_mapping_util_1.qboPayeeName)(into, !mixed)));
            if (!target) {
                const newName = (0, qbo_mapping_util_1.qboPayeeName)(into, mixed);
                await this.client.update(companyId, found.type, found.id, {
                    DisplayName: newName,
                });
                this.logger.log(`book #${bookId}: merge renamed QuickBooks ${found.type} ${found.id} "${oldName}" → "${newName}"`);
                continue;
            }
            if (target.id === found.id && target.type === found.type)
                continue;
            const moved = await this.repointAll(companyId, found, target);
            try {
                await this.client.update(companyId, found.type, found.id, {
                    Active: false,
                });
            }
            catch (err) {
                this.logger.warn(`book #${bookId}: could not make QuickBooks ${found.type} ${found.id} inactive: ${String(err)}`);
            }
            this.logger.log(`book #${bookId}: merged QuickBooks ${found.type} ${found.id} "${oldName}" into ${target.type} ${target.id} (${moved} transaction(s) moved)`);
        }
    }
    async repointAll(companyId, from, to) {
        let moved = 0;
        for (const type of ['Purchase', 'Deposit']) {
            for (let start = 1;; start += MERGE_PAGE) {
                const res = await this.client.query(companyId, `select * from ${type} STARTPOSITION ${start} MAXRESULTS ${MERGE_PAGE}`);
                const list = res[type] ?? [];
                for (const txn of list) {
                    const body = (0, qbo_mapping_util_1.repointEntity)(type, txn, from.id, to);
                    const id = typeof txn.Id === 'string' ? txn.Id : null;
                    if (!body || !id)
                        continue;
                    try {
                        await this.client.update(companyId, type, id, body);
                        moved++;
                    }
                    catch (err) {
                        this.stopOn(err);
                        this.logger.warn(`company #${companyId}: could not move QuickBooks ${type} ${id} to ${to.type} ${to.id}: ${String(err)}`);
                    }
                }
                if (list.length < MERGE_PAGE)
                    break;
            }
        }
        return moved;
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
            const mixed = await this.mixedNames(bookId);
            const linked = await this.linkedAnswers(bookId, rows);
            let cache = null;
            for (const row of rows) {
                if (writes >= MAX_PER_RUN) {
                    this.again.add(bookId);
                    break;
                }
                const family = this.familyOf(row, subNames, mixed, linked);
                if (!family)
                    continue;
                const hash = (0, qbo_mapping_util_1.familyHash)(family);
                if (row.qboId && row.qboHash === hash)
                    continue;
                cache ??= {
                    accounts: new Map(),
                    entities: new Map(),
                    types: await this.tax.typeContext(scope),
                    classes: new Map(),
                    locations: new Map(),
                    customers: new Map(),
                };
                writes++;
                await this.push(companyId, scope, row, family, hash, cache);
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
                data: {
                    qboId: null,
                    qboType: null,
                    qboHash: null,
                    qboSyncedAt: null,
                    qboError: null,
                },
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
    async mixedNames(bookId) {
        const groups = await this.prisma.bankTransaction.groupBy({
            by: ['name', 'offsetAccount'],
            where: {
                bookId,
                splitOfId: null,
                subNameId: { not: null },
                name: { not: null },
            },
        });
        const categories = new Map();
        for (const g of groups) {
            const key = g.name.trim().toLowerCase();
            const set = categories.get(key) ?? new Set();
            set.add(g.offsetAccount);
            categories.set(key, set);
        }
        return new Set([...categories].filter(([, c]) => c.size > 1).map(([k]) => k));
    }
    async linkedAnswers(bookId, rows) {
        const out = noLinkedAnswers();
        if (!rows.length)
            return out;
        const columns = await this.prisma.customColumn.findMany({
            where: { bookId, deletedAt: null, qboKind: { not: null } },
            select: { id: true, qboKind: true, qboRef: true },
        });
        if (!columns.length)
            return out;
        const byId = new Map(columns.map((c) => [c.id, c]));
        const ids = rows.flatMap((r) => [r.id, ...r.splits.map((s) => s.id)]);
        for (let i = 0; i < ids.length; i += 1000) {
            const answers = await this.prisma.customColumnAnswer.findMany({
                where: {
                    customColumnId: { in: [...byId.keys()] },
                    transactionId: { in: ids.slice(i, i + 1000) },
                },
                select: {
                    customColumnId: true,
                    transactionId: true,
                    value: true,
                    dropDown: { select: { label: true, deletedAt: true } },
                },
            });
            for (const a of answers) {
                const col = byId.get(a.customColumnId);
                if (!col)
                    continue;
                const value = (a.dropDown && !a.dropDown.deletedAt
                    ? a.dropDown.label
                    : (a.value ?? '')).trim();
                if (!value)
                    continue;
                if (col.qboKind === 'CLASS') {
                    out.classOf.set(a.transactionId, value);
                }
                else if (col.qboKind === 'LOCATION') {
                    out.locationOf.set(a.transactionId, value);
                }
                else if (col.qboKind === 'CUSTOMER') {
                    out.customerOf.set(a.transactionId, value);
                }
                else if (col.qboKind === 'FIELD' && col.qboRef) {
                    const list = out.fieldsOf.get(a.transactionId) ?? [];
                    list.push({ ref: col.qboRef, value });
                    out.fieldsOf.set(a.transactionId, list);
                }
            }
        }
        for (const list of out.fieldsOf.values())
            list.sort((x, y) => x.ref.localeCompare(y.ref));
        return out;
    }
    familyOf(row, subNames, mixed, linked = noLinkedAnswers()) {
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
            name: row.name
                ? (0, qbo_mapping_util_1.qboPayeeName)(row.name, mixed.has(row.name.trim().toLowerCase())) ||
                    null
                : null,
            description: row.description,
            kind: account.kind === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK',
            plaidAccountId: account.id,
            lines: (0, qbo_mapping_util_1.familyLines)({
                amount,
                category: row.offsetAccount,
                description: label(row.subNameId, null),
                className: linked.classOf.get(row.id) ?? null,
                customerName: linked.customerOf.get(row.id) ?? null,
            }, row.splits.map((s) => ({
                amount: Number(s.amount),
                category: s.offsetAccount,
                description: label(s.subNameId, s.name),
                className: linked.classOf.get(s.id) ?? null,
                customerName: linked.customerOf.get(s.id) ?? null,
            }))),
            ...(linked.fieldsOf.get(row.id)?.length
                ? { fields: linked.fieldsOf.get(row.id) }
                : {}),
            ...(linked.locationOf.get(row.id)
                ? { location: linked.locationOf.get(row.id) }
                : {}),
        };
    }
    async push(companyId, scope, row, family, hash, cache) {
        const type = (0, qbo_mapping_util_1.qboTypeOf)(family);
        try {
            const refs = await this.refsFor(companyId, scope, row, family, cache);
            let id = row.qboId;
            if (id && row.qboType !== type) {
                await this.removeQuietly(companyId, row.qboType, id);
                id = null;
            }
            const omit = {};
            const hasClass = !!refs.classIds?.size;
            const hasLocation = !!refs.departmentId;
            const hasCustomer = !!refs.customerIds?.size;
            for (;;) {
                try {
                    id = await this.write(companyId, type, id, (0, qbo_mapping_util_1.qboBody)(family, refs, omit));
                    break;
                }
                catch (err) {
                    this.stopOn(err);
                    const message = err instanceof Error ? err.message : String(err);
                    if (!omit.fields &&
                        family.fields?.length &&
                        /custom ?field/i.test(message)) {
                        omit.fields = true;
                    }
                    else if (!omit.classes && hasClass && /class/i.test(message)) {
                        omit.classes = true;
                    }
                    else if (!omit.locations &&
                        hasLocation &&
                        /department|location/i.test(message)) {
                        omit.locations = true;
                    }
                    else if (!omit.customers &&
                        hasCustomer &&
                        /customer|project/i.test(message)) {
                        omit.customers = true;
                    }
                    else {
                        throw err;
                    }
                    this.logger.warn(`row #${row.id}: QuickBooks refused part of it (${message}) — sending it without ${[
                        omit.fields && 'the custom fields',
                        omit.classes && 'the class',
                        omit.locations && 'the location',
                        omit.customers && 'the customer',
                    ]
                        .filter(Boolean)
                        .join(', ')}`);
                }
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
    async write(companyId, type, id, body) {
        if (id) {
            try {
                await this.client.update(companyId, type, id, body);
                return id;
            }
            catch (err) {
                this.stopOn(err);
                if (!this.isNotFound(err))
                    throw err;
            }
        }
        const res = await this.client.create(companyId, type, body);
        const made = res[type]?.Id ?? null;
        if (!made)
            throw new Error(`QuickBooks did not return the new ${type}'s id`);
        return made;
    }
    async classId(companyId, name, cache) {
        if (cache.classes.has(name))
            return cache.classes.get(name) ?? null;
        let id = null;
        try {
            id = await this.findOne(companyId, 'Class', `FullyQualifiedName = ${(0, qbo_mapping_util_1.qboQuote)(name)}`);
            if (!id && !name.includes(':')) {
                id = await this.created(companyId, 'Class', {
                    Name: name.slice(0, 100),
                });
            }
        }
        catch (err) {
            this.stopOn(err);
            this.logger.warn(`company #${companyId}: QuickBooks class "${name}" not found or made: ${err instanceof Error ? err.message : String(err)}`);
        }
        cache.classes.set(name, id);
        return id;
    }
    async listId(companyId, entity, name, cache) {
        if (cache.has(name))
            return cache.get(name) ?? null;
        let id = null;
        try {
            id =
                entity === 'Department'
                    ? await this.findOne(companyId, 'Department', `FullyQualifiedName = ${(0, qbo_mapping_util_1.qboQuote)(name)}`)
                    : ((await this.findOne(companyId, 'Customer', `DisplayName = ${(0, qbo_mapping_util_1.qboQuote)(name)}`)) ??
                        (name.includes(':')
                            ? await this.findOne(companyId, 'Customer', `FullyQualifiedName = ${(0, qbo_mapping_util_1.qboQuote)(name)}`)
                            : null));
            if (!id && entity === 'Department' && !name.includes(':')) {
                id = await this.created(companyId, 'Department', {
                    Name: name.slice(0, 100),
                });
            }
            if (!id && entity === 'Customer')
                this.logger.warn(`company #${companyId}: QuickBooks has no customer "${name}" — lines sent without it`);
        }
        catch (err) {
            this.stopOn(err);
            this.logger.warn(`company #${companyId}: QuickBooks ${entity === 'Department' ? 'location' : 'customer'} "${name}" not found or made: ${err instanceof Error ? err.message : String(err)}`);
        }
        cache.set(name, id);
        return id;
    }
    async refsFor(companyId, scope, row, family, cache) {
        const moneyOut = family.cents < 0;
        const accountIds = new Map();
        for (const line of family.lines) {
            const name = (0, qbo_mapping_util_1.qboCategoryName)(line.category, moneyOut);
            if (!name || accountIds.has(name))
                continue;
            accountIds.set(name, await this.accountId(companyId, name, (0, chart_of_accounts_1.typeFor)(line.category, cache.types), cache));
        }
        const classIds = new Map();
        for (const line of family.lines) {
            if (!line.className || classIds.has(line.className))
                continue;
            const id = await this.classId(companyId, line.className, cache);
            if (id)
                classIds.set(line.className, id);
        }
        const customerIds = new Map();
        if ((0, qbo_mapping_util_1.qboTypeOf)(family) === 'Purchase') {
            for (const line of family.lines) {
                if (!line.customerName || customerIds.has(line.customerName))
                    continue;
                const id = await this.listId(companyId, 'Customer', line.customerName, cache.customers);
                if (id)
                    customerIds.set(line.customerName, id);
            }
        }
        const departmentId = family.location
            ? await this.listId(companyId, 'Department', family.location, cache.locations)
            : null;
        return {
            departmentId,
            customerIds,
            bankAccountId: await this.bankAccountId(companyId, scope, row, cache),
            entity: family.name
                ? await this.entityFor(companyId, family.name, moneyOut, cache)
                : null,
            accountIds,
            classIds,
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
    async bankAccountId(companyId, scope, row, cache) {
        const account = row.statement.plaidAccount;
        if (account.qboAccountId)
            return account.qboAccountId;
        const name = (0, qbo_mapping_util_1.qboText)(account.accountName) || `Bank account ${account.id}`;
        const id = (await this.matchBankAccount(companyId, scope, account.id, cache)) ??
            (await this.findOne(companyId, 'Account', `Name = ${(0, qbo_mapping_util_1.qboQuote)(name)}`)) ??
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
    async matchBankAccount(companyId, scope, plaidAccountId, cache) {
        try {
            const plaid = await this.prisma.plaidAccount.findUnique({
                where: { id: plaidAccountId },
                select: {
                    accountName: true,
                    mask: true,
                    kind: true,
                    item: { select: { institutionName: true } },
                },
            });
            if (!plaid)
                return null;
            cache.bankAccounts ??= await this.qboBankAccounts(companyId);
            const taken = new Set((await this.prisma.plaidAccount.findMany({
                where: {
                    qboAccountId: { not: null },
                    item: { bookId: scope.bookId },
                    id: { not: plaidAccountId },
                },
                select: { qboAccountId: true },
            })).map((a) => a.qboAccountId));
            const ours = {
                accountName: plaid.accountName,
                mask: plaid.mask,
                institution: plaid.item.institutionName,
                kind: plaid.kind === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK',
            };
            const candidates = (0, qbo_bank_match_util_1.candidatesFor)(ours, cache.bankAccounts.filter((a) => !taken.has(a.id)));
            if (!candidates.length)
                return null;
            const since = new Date(Date.now() - MATCH_DAYS * 86_400_000);
            const ourRows = (await this.prisma.bankTransaction.findMany({
                where: {
                    splitOfId: null,
                    statement: { plaidAccountId, deletedAt: null },
                    OR: [
                        { postingDate: { gte: since } },
                        { pendingDate: { gte: since } },
                    ],
                },
                select: { amount: true, postingDate: true, pendingDate: true },
            })).flatMap((r) => {
                const d = r.postingDate ?? r.pendingDate;
                return d
                    ? [{ date: day(d), cents: Math.round(Number(r.amount) * 100) }]
                    : [];
            });
            cache.recent ??= await this.recentQboTxns(companyId, day(since));
            for (const { account, score } of candidates) {
                const theirs = cache.recent.get(account.id) ?? [];
                const v = (0, qbo_bank_match_util_1.verifyMatch)(ourRows, theirs);
                if ((0, qbo_bank_match_util_1.acceptMatch)(score, v, theirs.length)) {
                    this.logger.log(`company #${companyId}: Plaid account #${plaidAccountId} (${plaid.accountName}) is QuickBooks account ${account.id} "${account.name}" (name score ${score}, ${v.matched} of ${v.compared} transactions found)`);
                    return account.id;
                }
            }
            this.logger.log(`company #${companyId}: no QuickBooks account matched ${plaid.accountName} (checked ${candidates.map((c) => `"${c.account.name}"`).join(', ')})`);
            return null;
        }
        catch (err) {
            this.stopOn(err);
            this.logger.warn(`company #${companyId}: QuickBooks account match failed: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }
    async qboBankAccounts(companyId) {
        const out = [];
        for (const type of ['Bank', 'Credit Card']) {
            const res = await this.client.query(companyId, `select * from Account where AccountType = ${(0, qbo_mapping_util_1.qboQuote)(type)} MAXRESULTS ${MATCH_PAGE}`);
            for (const a of res.Account ?? []) {
                if (typeof a.Id !== 'string' || a.Active === false)
                    continue;
                out.push({
                    id: a.Id,
                    name: typeof a.Name === 'string' ? a.Name : '',
                    acctNum: typeof a.AcctNum === 'string' ? a.AcctNum : null,
                    type,
                });
            }
        }
        return out;
    }
    async recentQboTxns(companyId, since) {
        const out = new Map();
        const add = (account, date, cents) => {
            const id = account?.value;
            if (!id || typeof date !== 'string' || !cents)
                return;
            const list = out.get(id) ?? [];
            list.push({ date: date.slice(0, 10), cents });
            out.set(id, list);
        };
        for (const type of ['Purchase', 'Deposit']) {
            for (let page = 0; page < 10; page++) {
                const res = await this.client.query(companyId, `select * from ${type} where TxnDate >= ${(0, qbo_mapping_util_1.qboQuote)(since)} STARTPOSITION ${page * MATCH_PAGE + 1} MAXRESULTS ${MATCH_PAGE}`);
                const list = res[type] ?? [];
                for (const t of list) {
                    const total = Math.round(Math.abs(Number(t.TotalAmt ?? 0)) * 100);
                    if (type === 'Purchase') {
                        add(t.AccountRef, t.TxnDate, t.Credit === true ? total : -total);
                    }
                    else {
                        add(t.DepositToAccountRef, t.TxnDate, total);
                    }
                }
                if (list.length < MATCH_PAGE)
                    break;
            }
        }
        return out;
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
            .update({
            where: { id: rowId },
            data: { qboError: message.slice(0, 2000) },
        })
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