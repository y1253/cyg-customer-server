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
var NameMemoryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NameMemoryService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const chart_of_accounts_1 = require("./chart-of-accounts");
const ledger_util_1 = require("./ledger.util");
const scope_1 = require("./scope");
const tax_service_1 = require("./tax.service");
const reports_util_1 = require("./reports.util");
const name_memory_util_1 = require("./name-memory.util");
let NameMemoryService = NameMemoryService_1 = class NameMemoryService {
    prisma;
    tax;
    logger = new common_1.Logger(NameMemoryService_1.name);
    onApplicationBootstrap() {
        setTimeout(() => void this.backfillNames().then(() => this.backfillProvenance()), 60_000).unref();
    }
    async backfillNames() {
        try {
            const where = {
                name: null,
                offsetAccount: { not: chart_of_accounts_1.UNCATEGORIZED },
            };
            const books = await this.prisma.bankTransaction.groupBy({
                by: ['customerId', 'bookId', 'companyId'],
                where,
            });
            let named = 0;
            for (const b of books) {
                const descriptions = await this.prisma.bankTransaction.groupBy({
                    by: ['description'],
                    where: { ...where, ...(0, scope_1.scopeWhere)(b) },
                });
                for (const { description } of descriptions) {
                    const name = (0, name_memory_util_1.descriptionName)(description);
                    if (!name)
                        continue;
                    const done = await this.prisma.bankTransaction.updateMany({
                        where: { ...where, ...(0, scope_1.scopeWhere)(b), description },
                        data: { name },
                    });
                    named += done.count;
                }
                await this.syncProvenance(b);
            }
            if (named)
                this.logger.log(`named ${named} categorized row(s) by their description in ${books.length} book(s)`);
            return named;
        }
        catch (err) {
            this.logger.warn(`name backfill failed: ${String(err)}`);
            return 0;
        }
    }
    async backfillProvenance() {
        try {
            const books = await this.prisma.bankTransaction.groupBy({
                by: ['customerId', 'bookId', 'companyId'],
                where: { ruleName: null, name: { not: null }, splitOfId: null },
            });
            for (const b of books)
                await this.syncProvenance(b);
            if (books.length)
                this.logger.log(`provenance backfilled for ${books.length} book(s)`);
            return books.length;
        }
        catch (err) {
            this.logger.warn(`provenance backfill failed: ${String(err)}`);
            return 0;
        }
    }
    constructor(prisma, tax) {
        this.prisma = prisma;
        this.tax = tax;
    }
    async contextFor(scope, descriptions, names = []) {
        const keys = [...new Set(descriptions.map(name_memory_util_1.descriptionKey).filter(Boolean))];
        const [memoryRows, rules, customAccounts, renamed] = await Promise.all([
            keys.length
                ? this.prisma.descriptionMemory.findMany({
                    where: { descriptionKey: { in: keys } },
                    select: {
                        id: true,
                        descriptionKey: true,
                        name: true,
                        category: true,
                    },
                })
                : Promise.resolve([]),
            this.rulesOf(scope),
            this.customAccountsOf(scope),
            this.renamedAccountsOf(scope),
        ]);
        const memory = new Map(memoryRows.map((m) => [
            m.descriptionKey,
            { id: m.id, name: m.name, category: m.category },
        ]));
        const nameKeys = new Set();
        for (const n of [
            ...names,
            ...memoryRows.map((m) => m.name),
            ...rules.map((r) => r.name),
        ]) {
            const clean = (0, name_memory_util_1.cleanName)(n);
            if (clean)
                nameKeys.add((0, name_memory_util_1.nameKey)(clean));
        }
        const nameMemory = await this.nameMemoryFor([...nameKeys]);
        return {
            memory,
            ...(0, name_memory_util_1.indexRules)(rules),
            customAccounts,
            nameMemory,
            renamed,
        };
    }
    async nameMemoryFor(keys) {
        if (!keys.length)
            return new Map();
        const rows = await this.prisma.nameMemory.findMany({
            where: { nameKey: { in: keys } },
            select: { nameKey: true, category: true },
        });
        return new Map(rows.map((r) => [r.nameKey, r.category]));
    }
    async rulesOf(scope) {
        const rows = await this.prisma.customerNameRule.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: {
                id: true,
                matchType: true,
                matchKey: true,
                name: true,
                category: true,
                includeChars: true,
            },
        });
        return rows.map((r) => ({
            ...r,
            matchType: r.matchType === 'DESCRIPTION' ||
                r.matchType === 'CONTAINS' ||
                r.matchType === name_memory_util_1.EXCEPTION
                ? r.matchType
                : 'NAME',
        }));
    }
    async renamedAccountsOf(scope) {
        const rows = await this.prisma.customerAccount.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), replaces: { not: null } },
            select: { name: true, replaces: true },
        });
        return new Map(rows.flatMap((r) => r.replaces ? [[r.replaces.toLowerCase(), r.name]] : []));
    }
    async customAccountsOf(scope) {
        const rows = await this.prisma.customerAccount.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { name: true },
        });
        return new Set(rows.map((r) => r.name));
    }
    async resolveStatement(scope, rows, bankName = null, statementId) {
        try {
            const ctx = {
                ...(await this.contextFor(scope, rows.map((r) => r.description), rows.map((r) => r.name))),
                bankName,
            };
            const keyed = rows.map((r) => ({
                ...r,
                exceptionKey: statementId === undefined
                    ? undefined
                    : (0, name_memory_util_1.exceptionKey)({
                        statementId,
                        postingDate: r.postingDate,
                        pendingDate: r.pendingDate,
                        amount: r.amount,
                        description: r.description,
                    }),
            }));
            const { resolved } = (0, name_memory_util_1.resolveRows)(keyed, ctx);
            const lines = rows.map((r, i) => ({
                ...r,
                name: resolved[i].name,
                offsetAccount: resolved[i].category,
                provenance: {
                    generalRuleId: resolved[i].generalRuleId,
                    personalRuleId: resolved[i].personalRuleId,
                    exceptionRuleId: resolved[i].exceptionRuleId,
                    ruleName: resolved[i].ruleName,
                },
            }));
            await this.learn(rows, ctx.memory);
            await this.learnNames(resolved, ctx.nameMemory ?? new Map());
            return { lines, customAccounts: ctx.customAccounts };
        }
        catch (err) {
            this.logger.warn(`name memory unavailable for ${(0, scope_1.bookLabel)(scope)}, keeping the AI's answers: ${String(err)}`);
            const bank = (0, name_memory_util_1.bankPayeeName)(bankName);
            const lines = rows.map((r) => {
                let out = r;
                if (bank && !(0, name_memory_util_1.cleanName)(r.name) && (0, name_memory_util_1.isBankCharge)(r.offsetAccount)) {
                    out = { ...out, name: bank };
                }
                if ((0, name_memory_util_1.isOwnersLoanMove)(r.description, r.offsetAccount)) {
                    out = { ...out, offsetAccount: chart_of_accounts_1.OWNERS_LOAN };
                }
                const name = (0, name_memory_util_1.fallbackName)(out.name, out.offsetAccount, out.description);
                return name === out.name ? out : { ...out, name };
            });
            return { lines, customAccounts: new Set() };
        }
    }
    async saveRule(scope, input) {
        await this.applyRule(scope, input);
        await this.syncProvenance(scope);
    }
    async editTransaction(scope, id, input) {
        await this.applyEdit(scope, id, input);
        await this.syncProvenance(scope);
    }
    async mergeNames(scope, from, into) {
        await this.applyMerge(scope, from, into);
        await this.syncProvenance(scope);
    }
    async resetRule(scope, input) {
        await this.applyReset(scope, input);
        await this.syncProvenance(scope);
    }
    async syncProvenance(scope) {
        try {
            const rows = await this.prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), splitOfId: null },
                select: {
                    id: true,
                    statementId: true,
                    externalId: true,
                    postingDate: true,
                    pendingDate: true,
                    amount: true,
                    description: true,
                    name: true,
                    offsetAccount: true,
                    manualEdit: true,
                    generalRuleId: true,
                    personalRuleId: true,
                    exceptionRuleId: true,
                    ruleName: true,
                },
            });
            if (!rows.length)
                return;
            const ctx = await this.contextFor(scope, rows.map((r) => r.description), rows.map((r) => r.name));
            const exceptions = ctx.exceptions ?? new Map();
            const keep = new Set();
            const writes = new Map();
            for (const r of rows) {
                const key = (0, name_memory_util_1.exceptionKey)(r);
                const ruled = (0, name_memory_util_1.resolveRow)({
                    description: r.description,
                    name: r.manualEdit ? (r.ruleName ?? r.name) : r.name,
                    offsetAccount: r.offsetAccount,
                }, { ...ctx, exceptions: undefined });
                const differs = (0, name_memory_util_1.nameKey)(ruled.name ?? '') !== (0, name_memory_util_1.nameKey)(r.name ?? '') ||
                    ruled.category !== r.offsetAccount;
                let exceptionRuleId = null;
                const existing = exceptions.get(key);
                if (r.manualEdit && differs) {
                    exceptionRuleId = await this.saveException(scope, key, existing, r);
                    keep.add(exceptionRuleId);
                }
                const next = {
                    generalRuleId: ruled.generalRuleId,
                    personalRuleId: ruled.personalRuleId,
                    exceptionRuleId,
                    ruleName: ruled.name,
                };
                if (next.generalRuleId === r.generalRuleId &&
                    next.personalRuleId === r.personalRuleId &&
                    next.exceptionRuleId === r.exceptionRuleId &&
                    next.ruleName === r.ruleName)
                    continue;
                const k = JSON.stringify(next);
                writes.set(k, [...(writes.get(k) ?? []), r.id]);
            }
            for (const [k, ids] of writes) {
                const data = JSON.parse(k);
                for (let i = 0; i < ids.length; i += 1000) {
                    await this.prisma.bankTransaction.updateMany({
                        where: { id: { in: ids.slice(i, i + 1000) } },
                        data,
                    });
                }
            }
            const live = new Set(rows.map((r) => (0, name_memory_util_1.exceptionKey)(r)));
            const stale = [...exceptions.entries()]
                .filter(([key, rule]) => live.has(key) && rule.id !== undefined && !keep.has(rule.id))
                .map(([, rule]) => rule.id);
            if (stale.length) {
                await this.prisma.customerNameRule.deleteMany({
                    where: {
                        id: { in: stale },
                        ...(0, scope_1.scopeWhere)(scope),
                        matchType: name_memory_util_1.EXCEPTION,
                    },
                });
            }
        }
        catch (err) {
            this.logger.warn(`provenance of ${(0, scope_1.bookLabel)(scope)} not updated: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async saveException(scope, key, existing, row) {
        if (existing?.id !== undefined) {
            if (existing.name !== row.name ||
                existing.category !== row.offsetAccount) {
                await this.prisma.customerNameRule.update({
                    where: { id: existing.id },
                    data: { name: row.name, category: row.offsetAccount },
                });
            }
            return existing.id;
        }
        const created = await this.prisma.customerNameRule.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                matchType: name_memory_util_1.EXCEPTION,
                matchKey: key,
                name: row.name,
                category: row.offsetAccount,
            },
            select: { id: true },
        });
        return created.id;
    }
    async clearException(scope, id) {
        const row = await this.prisma.bankTransaction.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope) },
            select: {
                statementId: true,
                externalId: true,
                postingDate: true,
                pendingDate: true,
                amount: true,
                description: true,
            },
        });
        if (!row)
            return;
        await this.prisma.customerNameRule.deleteMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                matchType: name_memory_util_1.EXCEPTION,
                matchKey: (0, name_memory_util_1.exceptionKey)(row),
            },
        });
        await this.prisma.bankTransaction.update({
            where: { id },
            data: { manualEdit: false, exceptionRuleId: null },
        });
    }
    async learn(rows, memory) {
        const { creates, fills } = (0, name_memory_util_1.memoryWrites)(rows, memory);
        const reused = [
            ...new Set(rows.map((r) => (0, name_memory_util_1.descriptionKey)(r.description))),
        ].filter((k) => k && memory.has(k));
        if (creates.length) {
            await this.prisma.descriptionMemory.createMany({
                data: creates,
                skipDuplicates: true,
            });
        }
        for (const f of fills) {
            await this.prisma.descriptionMemory.update({
                where: { descriptionKey: f.descriptionKey },
                data: { name: f.name, category: f.category },
            });
        }
        if (reused.length) {
            await this.prisma.descriptionMemory.updateMany({
                where: { descriptionKey: { in: reused } },
                data: { hits: { increment: 1 } },
            });
        }
    }
    async learnNames(resolved, known) {
        const { creates, fills } = (0, name_memory_util_1.nameMemoryWrites)(resolved, known);
        if (creates.length) {
            await this.prisma.nameMemory.createMany({
                data: creates,
                skipDuplicates: true,
            });
        }
        for (const f of fills) {
            await this.prisma.nameMemory.update({
                where: { nameKey: f.nameKey },
                data: { category: f.category },
            });
        }
        const reused = [
            ...new Set(resolved.flatMap((r) => r.followsName && r.name ? [(0, name_memory_util_1.nameKey)(r.name)] : [])),
        ].filter((k) => known.has(k));
        if (reused.length) {
            await this.prisma.nameMemory.updateMany({
                where: { nameKey: { in: reused } },
                data: { hits: { increment: 1 } },
            });
        }
    }
    async applyRule(scope, input) {
        const matchKey = ruleKeyOf(input.matchType, input.matchKey);
        const name = (0, name_memory_util_1.cleanName)(input.name);
        const category = input.category
            ? (0, chart_of_accounts_1.normalizeAccount)(input.category, await this.customAccountsOf(scope))
            : null;
        if (name &&
            input.matchType !== 'NAME' &&
            (input.matchType === 'CONTAINS' || (input.scope ?? 'ALWAYS') === 'ALWAYS')) {
            await this.guardLinks(scope, input.matchType, matchKey, name, input.replace);
        }
        const where = {
            ...(0, scope_1.scopeWhere)(scope),
            matchType: input.matchType,
            matchKey,
        };
        const previous = await this.prisma.customerNameRule.findFirst({ where });
        if (input.matchType === 'CONTAINS') {
            await this.saveContainsRule(scope, previous, where, input.matchKey, name, category);
            return;
        }
        if (input.matchType === 'NAME') {
            const names = new Set([matchKey]);
            if (previous?.name)
                names.add((0, name_memory_util_1.nameKey)(previous.name));
            if (!name) {
                if (category) {
                    await this.setNameCategory(scope, (0, name_memory_util_1.cleanName)(previous?.name) ?? matchKey, category);
                }
                return;
            }
            const target = await this.categoryOfName(scope, name);
            await this.upsertRule(previous, { ...where, name }, { name });
            const rows = await this.matchingRows(scope, 'NAME', matchKey, names, false);
            await this.writeRows(scope, rows, (row) => ({
                name,
                category: row.offsetAccount,
            }));
            await this.tax.carryAgencies(scope, [...names], name);
            await this.tax.carryNameSettings(scope, [...names], name);
            const adopt = category ?? target;
            if (adopt)
                await this.setNameCategory(scope, name, adopt);
            return;
        }
        const editScope = input.scope ?? 'ALWAYS';
        if (name) {
            const target = await this.categoryOfName(scope, name);
            if (editScope === 'ALWAYS') {
                await this.upsertRule(previous, { ...where, name }, { name, category: null });
            }
            const rows = await this.matchingRows(scope, 'DESCRIPTION', matchKey, new Set(), editScope === 'ONCE');
            await this.writeRows(scope, rows, (row) => ({ name, category: row.offsetAccount }), editScope === 'ONCE');
            const adopt = category ?? target;
            if (adopt)
                await this.setNameCategory(scope, name, adopt);
            return;
        }
        if (!category)
            return;
        await this.upsertRule(previous, { ...where, category }, { category });
        const rows = await this.matchingRows(scope, 'DESCRIPTION', matchKey, new Set(), true);
        await this.writeRows(scope, rows.filter((r) => !(0, name_memory_util_1.cleanName)(r.name)), () => ({ name: null, category }));
    }
    async saveContainsRule(scope, previous, where, raw, name, category) {
        const includeChars = raw.trim().slice(0, 191);
        if (includeChars.length < name_memory_util_1.CONTAINS_MIN) {
            throw new common_1.BadRequestException(`Type at least ${name_memory_util_1.CONTAINS_MIN} characters the description must contain.`);
        }
        if (!name && !category) {
            throw new common_1.BadRequestException('Pick a name or a category for this rule.');
        }
        const rows = await this.containsRows(scope, where.matchKey);
        if (name) {
            const target = await this.categoryOfName(scope, name);
            await this.upsertRule(previous, { ...where, includeChars, name, category: null }, { includeChars, name, category: null });
            await this.writeRows(scope, rows, (row) => ({
                name,
                category: row.offsetAccount,
            }));
            const adopt = category ?? target;
            if (adopt)
                await this.setNameCategory(scope, name, adopt);
            return;
        }
        await this.upsertRule(previous, { ...where, includeChars, name: null, category }, { includeChars, name: null, category });
        const { nameCategories } = (0, name_memory_util_1.indexRules)(await this.rulesOf(scope));
        await this.writeRows(scope, rows, (row) => {
            const own = row.name ? nameCategories.get((0, name_memory_util_1.nameKey)(row.name)) : undefined;
            return { name: row.name, category: own ?? category };
        });
    }
    async guardLinks(scope, matchType, key, name, replace) {
        if (replace && matchType === 'DESCRIPTION')
            return;
        if (matchType === 'CONTAINS' && key.length < name_memory_util_1.CONTAINS_MIN)
            return;
        const [rules, rows] = await Promise.all([
            this.rulesOf(scope),
            this.prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), splitOfId: null },
                select: { description: true },
            }),
        ]);
        const conflicts = (0, name_memory_util_1.findLinkConflicts)({
            matchType,
            key,
            name,
            rules,
            descriptions: [...new Set(rows.map((r) => r.description))],
        });
        if (!conflicts.length)
            return;
        if (!replace) {
            throw new common_1.ConflictException({
                code: name_memory_util_1.RULE_CONFLICT,
                message: (0, name_memory_util_1.linkConflictMessage)(conflicts, name),
                conflicts: conflicts.map(({ matchType: type, text, name: from }) => ({
                    matchType: type,
                    text,
                    name: from,
                })),
            });
        }
        const ids = conflicts.flatMap((c) => c.remove && c.ruleId ? [c.ruleId] : []);
        if (ids.length) {
            await this.prisma.customerNameRule.deleteMany({
                where: { ...(0, scope_1.scopeWhere)(scope), id: { in: ids } },
            });
        }
    }
    async containsRows(scope, key) {
        const rules = await this.prisma.customerNameRule.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                matchType: { in: ['DESCRIPTION', 'CONTAINS'] },
            },
            select: { matchType: true, matchKey: true },
        });
        const exact = new Set(rules.filter((r) => r.matchType === 'DESCRIPTION').map((r) => r.matchKey));
        const contains = [
            ...rules.filter((r) => r.matchType === 'CONTAINS' && r.matchKey !== key),
            { matchKey: key },
        ].sort(name_memory_util_1.byContainsPriority);
        const rows = await this.matchingRows(scope, 'DESCRIPTION', '', new Set(), false, true);
        return rows.filter((r) => (0, name_memory_util_1.descriptionContains)(r.description, key) &&
            !exact.has((0, name_memory_util_1.descriptionKey)(r.description)) &&
            contains.find((c) => (0, name_memory_util_1.descriptionContains)(r.description, c.matchKey))
                ?.matchKey === key);
    }
    async applyEdit(scope, id, input) {
        const row = await this.prisma.bankTransaction.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope) },
            select: { ...MATCH_SELECT, manualEdit: true, splitOfId: true },
        });
        if (!row)
            throw new common_1.NotFoundException('Transaction not found');
        const custom = await this.customAccountsOf(scope);
        const name = (0, name_memory_util_1.cleanName)(input.name);
        const category = input.category
            ? (0, chart_of_accounts_1.normalizeAccount)(input.category, custom)
            : null;
        const matched = toMatched(row);
        if (row.splitOfId) {
            await this.writeRows(scope, [matched], (r) => ({
                name: name ?? r.name,
                category: category ?? r.offsetAccount,
            }), true);
            return;
        }
        const key = (0, name_memory_util_1.descriptionKey)(row.description);
        if (name && name !== row.name) {
            if (input.scope === 'ONCE') {
                const target = await this.categoryOfName(scope, name);
                await this.writeRows(scope, [matched], (r) => ({ name, category: r.offsetAccount }), true);
                const adopt = category ?? target;
                if (adopt)
                    await this.setNameCategory(scope, name, adopt);
                return;
            }
            if (!key) {
                throw new common_1.BadRequestException('This transaction has no description to remember. Apply the name to this row only.');
            }
            await this.guardLinks(scope, 'DESCRIPTION', key, name, input.replace);
            if (row.manualEdit) {
                await this.writeRows(scope, [matched], (r) => ({
                    name,
                    category: r.offsetAccount,
                }));
                await this.clearException(scope, row.id);
            }
            await this.applyRule(scope, {
                matchType: 'DESCRIPTION',
                matchKey: key,
                name,
                category,
                scope: 'ALWAYS',
                replace: true,
            });
            return;
        }
        if (!category)
            return;
        const current = (0, name_memory_util_1.cleanName)(row.name);
        if (current) {
            await this.setNameCategory(scope, current, category);
        }
        else if (key) {
            await this.applyRule(scope, {
                matchType: 'DESCRIPTION',
                matchKey: key,
                name: null,
                category,
            });
        }
        else {
            await this.writeRows(scope, [matched], (r) => ({ name: r.name, category }), true);
        }
    }
    async setNameCategory(scope, name, category) {
        const key = (0, name_memory_util_1.nameKey)(name);
        const rules = await this.prisma.customerNameRule.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), matchType: 'NAME' },
            select: { id: true, matchKey: true, name: true },
        });
        const targeting = rules.filter((r) => ((0, name_memory_util_1.cleanName)(r.name) ? (0, name_memory_util_1.nameKey)(r.name) : r.matchKey) === key);
        if (targeting.length) {
            await this.prisma.customerNameRule.updateMany({
                where: { id: { in: targeting.map((r) => r.id) } },
                data: { category },
            });
        }
        else if (!rules.some((r) => r.matchKey === key)) {
            await this.prisma.customerNameRule.create({
                data: {
                    ...(0, scope_1.scopeWhere)(scope),
                    matchType: 'NAME',
                    matchKey: key,
                    category,
                },
            });
        }
        const rows = await this.prisma.bankTransaction.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), name: key, splitOfId: null },
            select: MATCH_SELECT,
        });
        await this.writeRows(scope, rows.map(toMatched), (r) => ({
            name: r.name,
            category,
        }));
    }
    async categoryOfName(scope, name) {
        const key = (0, name_memory_util_1.nameKey)(name);
        const own = (0, name_memory_util_1.indexRules)(await this.rulesOf(scope)).nameCategories.get(key);
        if (own)
            return own;
        const remembered = await this.prisma.nameMemory.findUnique({
            where: { nameKey: key },
            select: { category: true },
        });
        if (remembered && remembered.category !== chart_of_accounts_1.UNCATEGORIZED) {
            return remembered.category;
        }
        const groups = await this.prisma.bankTransaction.groupBy({
            by: ['offsetAccount'],
            where: { ...(0, scope_1.scopeWhere)(scope), name: key, splitOfId: null },
            _count: { _all: true },
        });
        const usual = groups
            .filter((g) => g.offsetAccount !== chart_of_accounts_1.UNCATEGORIZED)
            .sort((a, b) => b._count._all - a._count._all)[0];
        return usual?.offsetAccount ?? null;
    }
    async ruleKeyForName(scope, name) {
        const key = (0, name_memory_util_1.nameKey)(name);
        const rules = await this.prisma.customerNameRule.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), matchType: 'NAME' },
            select: { matchKey: true, name: true },
        });
        const hit = rules.find((r) => r.matchKey === key || (r.name && (0, name_memory_util_1.nameKey)(r.name) === key));
        return hit?.matchKey ?? key;
    }
    async applyMerge(scope, from, into) {
        const source = (0, name_memory_util_1.cleanName)(from);
        const target = (0, name_memory_util_1.cleanName)(into);
        if (!source || !target)
            throw new common_1.BadRequestException('Pick two names.');
        if ((0, name_memory_util_1.nameKey)(source) === (0, name_memory_util_1.nameKey)(target))
            throw new common_1.BadRequestException('That is the same name.');
        if ([source, target].some((n) => (0, name_memory_util_1.nameKey)(n) === (0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME)))
            throw new common_1.BadRequestException('"Unclarified name" cannot be merged — give its rows a name instead.');
        const agencies = await this.prisma.taxAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            select: { name: true },
        });
        const agency = [source, target].find((n) => agencies.some((a) => (0, name_memory_util_1.nameKey)(a.name) === (0, name_memory_util_1.nameKey)(n)));
        if (agency)
            throw new common_1.BadRequestException(`"${agency}" is a tax agency — tax agencies cannot be merged.`);
        const rows = await this.matchingRows(scope, 'NAME', (0, name_memory_util_1.nameKey)(source), new Set([(0, name_memory_util_1.nameKey)(source)]), true);
        if (!rows.length)
            throw new common_1.NotFoundException(`No rows are named "${source}".`);
        const category = (await this.categoryOfName(scope, target)) ?? chart_of_accounts_1.UNCATEGORIZED;
        await this.prisma.customerNameRule.updateMany({
            where: { ...(0, scope_1.scopeWhere)(scope), name: source },
            data: { name: target },
        });
        const where = {
            ...(0, scope_1.scopeWhere)(scope),
            matchType: 'NAME',
            matchKey: (0, name_memory_util_1.nameKey)(source),
        };
        const previous = await this.prisma.customerNameRule.findFirst({ where });
        await this.upsertRule(previous, { ...where, name: target, category: null }, { name: target, category: null });
        await this.writeRows(scope, rows, () => ({ name: target, category }));
        if (category !== chart_of_accounts_1.UNCATEGORIZED)
            await this.setNameCategory(scope, target, category);
        await this.prisma.ledgerNameAgency.deleteMany({
            where: { ...(0, scope_1.scopeWhere)(scope), name: source },
        });
        await this.prisma.ledgerName.deleteMany({
            where: { ...(0, scope_1.scopeWhere)(scope), name: source },
        });
        this.logger.log(`book ${(0, scope_1.bookLabel)(scope)}: merged name "${source}" into "${target}" (${rows.length} rows)`);
    }
    async applyReset(scope, input) {
        const matchKey = ruleKeyOf(input.matchType, input.matchKey);
        const rule = await this.prisma.customerNameRule.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), matchType: input.matchType, matchKey },
        });
        if (!rule)
            throw new common_1.NotFoundException('That name has no saved change');
        if (input.matchType === 'CONTAINS') {
            const reached = await this.containsRows(scope, matchKey);
            await this.prisma.customerNameRule.delete({ where: { id: rule.id } });
            await this.reresolveAfterContains(scope, rule, reached);
            return;
        }
        await this.prisma.customerNameRule.delete({ where: { id: rule.id } });
        const names = new Set([matchKey]);
        if (rule.name)
            names.add((0, name_memory_util_1.nameKey)(rule.name));
        const rows = await this.matchingRows(scope, input.matchType, matchKey, names, false);
        if (!rows.length)
            return;
        const ctx = await this.contextFor(scope, rows.map((r) => r.description), rows.map((r) => r.name));
        await this.writeRows(scope, rows, (row) => {
            const key = (0, name_memory_util_1.descriptionKey)(row.description);
            const remembered = key ? ctx.memory.get(key) : undefined;
            const base = input.matchType === 'NAME'
                ? {
                    description: row.description,
                    name: remembered?.name ?? originalName(row.name, matchKey),
                    offsetAccount: remembered?.category ?? row.offsetAccount,
                }
                : {
                    description: row.description,
                    name: remembered?.name ?? null,
                    offsetAccount: remembered?.category ?? chart_of_accounts_1.UNCATEGORIZED,
                };
            const out = (0, name_memory_util_1.resolveRow)(base, ctx);
            return { name: out.name, category: out.category };
        });
    }
    async reresolveAfterContains(scope, rule, rows) {
        if (!rows.length)
            return;
        const ctx = await this.contextFor(scope, rows.map((r) => r.description), rows.map((r) => r.name));
        const renamed = !!(0, name_memory_util_1.cleanName)(rule.name);
        await this.writeRows(scope, rows, (row) => {
            const key = (0, name_memory_util_1.descriptionKey)(row.description);
            const remembered = key ? ctx.memory.get(key) : undefined;
            const out = (0, name_memory_util_1.resolveRow)({
                description: row.description,
                name: remembered?.name ?? (renamed ? null : row.name),
                offsetAccount: remembered?.category ??
                    (rule.category ? chart_of_accounts_1.UNCATEGORIZED : row.offsetAccount),
            }, ctx);
            return { name: out.name, category: out.category };
        });
    }
    async upsertRule(existing, create, update) {
        if (existing) {
            await this.prisma.customerNameRule.update({
                where: { id: existing.id },
                data: update,
            });
        }
        else {
            try {
                await this.prisma.customerNameRule.create({ data: create });
            }
            catch (e) {
                if (e.code !== 'P2002')
                    throw e;
                throw new common_1.ConflictException({
                    code: name_memory_util_1.RULE_CONFLICT,
                    message: 'This was just changed by another save. Refresh the page and try again.',
                    conflicts: [],
                });
            }
        }
    }
    async matchingRows(scope, matchType, matchKey, names, includeManual, all = false) {
        const manual = includeManual
            ? { splitOfId: null }
            : { manualEdit: false, splitOfId: null };
        if (matchType === 'NAME') {
            const rows = await this.prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), name: { in: [...names] }, ...manual },
                select: MATCH_SELECT,
            });
            return rows.map(toMatched);
        }
        const rows = await this.prisma.bankTransaction.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), ...manual },
            select: MATCH_SELECT,
        });
        if (all)
            return rows.map(toMatched);
        return rows
            .filter((r) => (0, name_memory_util_1.descriptionKey)(r.description) === matchKey)
            .map(toMatched);
    }
    async writeRows(scope, rows, next, manual = false) {
        const updates = rows.flatMap((row) => {
            const out = next(row);
            const category = out.category;
            const name = (0, name_memory_util_1.fallbackName)(out.name, category, row.description);
            if (name === row.name && category === row.offsetAccount)
                return [];
            const bank = row.amount < 0 ? row.creditAccount : row.debitAccount;
            return [
                this.prisma.bankTransaction.update({
                    where: { id: row.id },
                    data: {
                        name,
                        offsetAccount: category,
                        ...(0, ledger_util_1.doubleEntry)(row.amount, bank, category),
                        ...(manual && { manualEdit: true }),
                    },
                }),
            ];
        });
        if (!updates.length)
            return;
        await this.prisma.$transaction(updates);
    }
};
exports.NameMemoryService = NameMemoryService;
exports.NameMemoryService = NameMemoryService = NameMemoryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        tax_service_1.TaxService])
], NameMemoryService);
const MATCH_SELECT = {
    id: true,
    description: true,
    name: true,
    amount: true,
    offsetAccount: true,
    debitAccount: true,
    creditAccount: true,
};
const ruleKeyOf = (matchType, raw) => matchType === 'NAME'
    ? (0, name_memory_util_1.nameKey)(raw)
    : matchType === 'CONTAINS'
        ? (0, name_memory_util_1.containsKey)(raw)
        : (0, name_memory_util_1.descriptionKey)(raw) || raw.trim().toLowerCase();
function originalName(current, matchKey) {
    if (current && (0, name_memory_util_1.nameKey)(current) === matchKey)
        return current;
    return matchKey.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
function toMatched(r) {
    return {
        id: r.id,
        description: r.description,
        name: r.name,
        amount: Number(r.amount.toString()),
        offsetAccount: r.offsetAccount,
        debitAccount: r.debitAccount,
        creditAccount: r.creditAccount,
    };
}
//# sourceMappingURL=name-memory.service.js.map