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
const sub_name_parents_1 = require("./sub-name-parents");
const attachment_name_util_1 = require("./attachment-name.util");
const custom_column_defaults_1 = require("./custom-column-defaults");
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
                subNameId: true,
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
                    subNameId: resolved[i].subNameId,
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
        if (input.matchType === 'NAME') {
            if (input.category)
                await (0, sub_name_parents_1.refuseWrapper)(this.prisma, scope, input.name ?? input.matchKey);
        }
        else if (input.subNameId == null &&
            (input.matchType === 'CONTAINS' || (input.scope ?? 'ALWAYS') === 'ALWAYS')) {
            await (0, sub_name_parents_1.refuseWrapper)(this.prisma, scope, input.name);
        }
        await this.applyRule(scope, input);
        await this.syncProvenance(scope);
    }
    async editTransaction(scope, id, input) {
        await this.applyEdit(scope, id, input);
        await this.syncProvenance(scope);
    }
    async setCategoryOfName(scope, name, category) {
        const clean = (0, name_memory_util_1.cleanName)(name);
        if (!clean)
            return;
        await (0, sub_name_parents_1.refuseWrapper)(this.prisma, scope, clean);
        await this.setNameCategory(scope, clean, (0, chart_of_accounts_1.normalizeAccount)(category, await this.customAccountsOf(scope)));
        await this.syncProvenance(scope);
    }
    async mergeNames(scope, from, into) {
        await (0, sub_name_parents_1.refuseWrapper)(this.prisma, scope, from);
        if (await this.isWrapper(scope, into)) {
            const category = (await this.categoryOfName(scope, from)) ?? chart_of_accounts_1.UNCATEGORIZED;
            const sub = await (0, sub_name_parents_1.ensureSubName)(this.prisma, scope, into, category);
            return this.mergeIntoSubName(scope, from, sub.id);
        }
        await this.applyMerge(scope, from, into);
        await this.syncProvenance(scope);
    }
    async mergeIntoSubName(scope, from, subNameId) {
        await (0, sub_name_parents_1.refuseWrapper)(this.prisma, scope, from);
        const sub = await this.subNameOfBook(scope, subNameId);
        await this.applyMerge(scope, from, sub.parent, sub);
        await this.syncProvenance(scope);
    }
    async mergeSubName(scope, fromId, into) {
        const from = await this.subNameOfBook(scope, fromId);
        let target;
        let intoSubId = into.subNameId ?? null;
        if (intoSubId == null &&
            into.name &&
            (await this.isWrapper(scope, into.name)))
            intoSubId = (await (0, sub_name_parents_1.ensureSubName)(this.prisma, scope, (0, name_memory_util_1.cleanName)(into.name) ?? into.name, from.category)).id;
        if (intoSubId != null) {
            const sub = await this.subNameOfBook(scope, intoSubId);
            if (sub.id === from.id)
                throw new common_1.BadRequestException('That is the same sub-name.');
            target = { name: sub.parent, category: sub.category, sub };
        }
        else {
            const name = (0, name_memory_util_1.cleanName)(into.name);
            if (!name)
                throw new common_1.BadRequestException('Pick a name to merge it into.');
            await (0, sub_name_parents_1.refuseWrapper)(this.prisma, scope, name);
            if ((0, name_memory_util_1.nameKey)(name) === (0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME))
                throw new common_1.BadRequestException('"Unclarified name" cannot be merged — give its rows a name instead.');
            const agencies = await this.prisma.taxAgency.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
                select: { name: true },
            });
            if (agencies.some((a) => (0, name_memory_util_1.nameKey)(a.name) === (0, name_memory_util_1.nameKey)(name)))
                throw new common_1.BadRequestException(`"${name}" is a tax agency — tax agencies cannot be merged.`);
            target = {
                name,
                category: (await this.categoryOfName(scope, name)) ?? chart_of_accounts_1.UNCATEGORIZED,
                sub: null,
            };
        }
        const rows = await this.moveSubNameRows(scope, from.id, {
            name: target.name,
            category: target.category,
            subId: target.sub?.id ?? null,
        });
        if (target.sub) {
            await this.tax.moveSubNameKeys(scope, from.name, target.sub.name);
            await this.addFields(scope, from.fields, { subNameId: target.sub.id });
        }
        else {
            await this.tax.dropSubNameKeys(scope, from.name, target.name);
            await this.addFields(scope, from.fields, { name: target.name });
        }
        if (await this.prisma.customColumnNameAnswer.count({
            where: { subNameId: from.id },
        }))
            await (0, custom_column_defaults_1.moveNameAnswers)(this.prisma, { subNameId: from.id }, target.sub
                ? { subNameId: target.sub.id }
                : { nameId: await (0, sub_name_parents_1.ledgerNameId)(this.prisma, scope, target.name) });
        await (0, sub_name_parents_1.deleteSubName)(this.prisma, from.id);
        this.logger.log(`book ${(0, scope_1.bookLabel)(scope)}: merged sub-name "${from.name}" into "${target.sub?.name ?? target.name}" (${rows} rows)`);
        await this.syncProvenance(scope);
    }
    async reparentSubNameRows(scope, subNameId, parent) {
        const sub = await this.subNameOfBook(scope, subNameId);
        const rows = await this.moveSubNameRows(scope, sub.id, {
            name: parent,
            category: sub.category,
            subId: sub.id,
        });
        this.logger.log(`book ${(0, scope_1.bookLabel)(scope)}: sub-name "${sub.name}" moved under "${parent}" (${rows} rows)`);
        await this.syncProvenance(scope);
    }
    async moveSubNameRows(scope, fromId, target) {
        const from = { id: fromId };
        const subId = target.subId;
        const moved = await this.prisma.customerNameRule.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), subNameId: from.id },
            select: { id: true },
        });
        await this.prisma.customerNameRule.updateMany({
            where: { ...(0, scope_1.scopeWhere)(scope), subNameId: from.id },
            data: {
                name: target.name,
                subNameId: subId,
                category: subId ? target.category : null,
            },
        });
        const movedIds = new Set(moved.map((r) => r.id));
        const rows = await this.prisma.bankTransaction.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), subNameId: from.id },
            select: {
                ...MATCH_SELECT,
                splitOfId: true,
                splitOf: {
                    select: { amount: true, debitAccount: true, creditAccount: true },
                },
            },
        });
        const tops = rows.filter((r) => !r.splitOfId);
        const keys = [...new Set(tops.map((r) => (0, name_memory_util_1.descriptionKey)(r.description)))]
            .filter(Boolean)
            .filter((key) => tops.some((r) => (0, name_memory_util_1.descriptionKey)(r.description) === key &&
            !(r.personalRuleId && movedIds.has(r.personalRuleId))));
        const ruleOf = new Map();
        if (keys.length) {
            const book = await this.prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), splitOfId: null },
                select: { description: true, subNameId: true },
            });
            for (const key of keys) {
                const elsewhere = book.some((r) => r.subNameId !== from.id && (0, name_memory_util_1.descriptionKey)(r.description) === key);
                if (elsewhere)
                    continue;
                const where = {
                    ...(0, scope_1.scopeWhere)(scope),
                    matchType: 'DESCRIPTION',
                    matchKey: key,
                };
                const data = {
                    name: target.name,
                    category: subId ? target.category : null,
                    subNameId: subId,
                };
                const previous = await this.prisma.customerNameRule.findFirst({
                    where,
                    select: { id: true },
                });
                await this.upsertRule(previous, { ...where, ...data }, data);
                const rule = await this.prisma.customerNameRule.findFirst({
                    where,
                    select: { id: true },
                });
                if (rule)
                    ruleOf.set(key, rule.id);
            }
        }
        if (rows.length)
            await this.prisma.$transaction(rows.map((r) => {
                const of = r.splitOf ?? r;
                const amount = Number(of.amount);
                const bank = amount < 0 ? of.creditAccount : of.debitAccount;
                const ruleId = r.splitOfId
                    ? undefined
                    : ruleOf.get((0, name_memory_util_1.descriptionKey)(r.description));
                const foreign = !r.splitOfId &&
                    ruleId === undefined &&
                    !(r.personalRuleId && movedIds.has(r.personalRuleId));
                return this.prisma.bankTransaction.update({
                    where: { id: r.id },
                    data: {
                        name: target.name,
                        subNameId: subId,
                        offsetAccount: target.category,
                        ...(0, ledger_util_1.doubleEntry)(amount, bank, target.category),
                        ...(ruleId !== undefined && { personalRuleId: ruleId }),
                        ...(foreign && { manualEdit: true }),
                    },
                });
            }));
        return rows.length;
    }
    async isWrapper(scope, name) {
        const clean = (0, name_memory_util_1.cleanName)(name);
        if (!clean)
            return false;
        return (await (0, sub_name_parents_1.wrapperNames)(this.prisma, scope)).has((0, attachment_name_util_1.nameKeyOf)(clean));
    }
    async subNameOfBook(scope, id) {
        const sub = await this.prisma.subName.findFirst({
            where: { id, bookId: scope.bookId, customerId: scope.customerId },
        });
        const parent = sub
            ? await this.prisma.ledgerName.findUnique({
                where: { id: sub.nameId },
                select: { name: true },
            })
            : null;
        if (!sub || !parent)
            throw new common_1.NotFoundException('Sub-name not found');
        return { ...sub, parent: parent.name };
    }
    async addFields(scope, raw, into) {
        const extra = (0, tax_service_1.parseNameFields)(raw);
        if (!extra.length)
            return;
        const merged = (own) => {
            const seen = new Set(own.map((f) => `${f.kind}|${f.value.toLowerCase()}`));
            return [
                ...own,
                ...extra.filter((f) => !seen.has(`${f.kind}|${f.value.toLowerCase()}`)),
            ];
        };
        if ('subNameId' in into) {
            const sub = await this.prisma.subName.findUnique({
                where: { id: into.subNameId },
                select: { fields: true },
            });
            await this.prisma.subName.update({
                where: { id: into.subNameId },
                data: { fields: merged((0, tax_service_1.parseNameFields)(sub?.fields)) },
            });
            return;
        }
        const row = await this.prisma.ledgerName.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), name: into.name },
            select: { id: true, fields: true },
        });
        if (row)
            await this.prisma.ledgerName.update({
                where: { id: row.id },
                data: { fields: merged((0, tax_service_1.parseNameFields)(row.fields)) },
            });
        else
            await this.prisma.ledgerName.create({
                data: { ...(0, scope_1.scopeWhere)(scope), name: into.name, fields: merged([]) },
            });
    }
    async resetRule(scope, input) {
        await this.applyReset(scope, input);
        await this.syncProvenance(scope);
    }
    async syncSubNameRules(scope, parentIds) {
        try {
            const parents = await this.prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), id: { in: parentIds }, splitOfId: null },
                select: { description: true },
            });
            const keys = [
                ...new Set(parents.map((p) => (0, name_memory_util_1.descriptionKey)(p.description))),
            ].filter(Boolean);
            for (const key of keys)
                await this.syncSubNameRule(scope, key, parentIds);
        }
        catch (err) {
            this.logger.warn(`sub-name rules of ${(0, scope_1.bookLabel)(scope)} not updated: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async syncSubNameRule(scope, key, preferIds) {
        const rule = await this.prisma.customerNameRule.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), matchType: 'DESCRIPTION', matchKey: key },
        });
        const oneTimeSubs = new Set((await this.prisma.subName.findMany({
            where: { bookId: scope.bookId, NOT: { splitKey: '' } },
            select: { id: true },
        })).map((s) => s.id));
        const candidates = (await this.prisma.bankTransaction.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                splitOfId: null,
                manualEdit: false,
                subNameId: { not: null },
                name: { not: null },
                splits: { some: { splitRuleId: null } },
            },
            select: { id: true, description: true, name: true, subNameId: true },
            orderBy: { id: 'desc' },
        }))
            .filter((p) => (0, name_memory_util_1.descriptionKey)(p.description) === key)
            .filter((p) => !oneTimeSubs.has(p.subNameId))
            .filter((p) => !(0, name_memory_util_1.cleanName)(rule?.name) ||
            (0, name_memory_util_1.nameKey)(rule.name) === (0, name_memory_util_1.nameKey)(p.name ?? ''))
            .sort((a, b) => Number(preferIds.includes(b.id)) - Number(preferIds.includes(a.id)));
        const source = candidates[0];
        const oldSubId = rule?.subNameId ?? null;
        if (!source) {
            if (!rule || oldSubId === null)
                return;
            await this.prisma.customerNameRule.update({
                where: { id: rule.id },
                data: { subNameId: null, category: null },
            });
            const rows = await this.prisma.bankTransaction.findMany({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    splitOfId: null,
                    subNameId: oldSubId,
                    splits: { none: {} },
                },
                select: MATCH_SELECT,
            });
            const back = new Map();
            for (const r of rows) {
                const k = (0, name_memory_util_1.nameKey)(r.name ?? '');
                if (!back.has(k))
                    back.set(k, r.name ? await this.categoryOfName(scope, r.name) : null);
            }
            await this.writeRows(scope, rows.map(toMatched), (r) => ({
                name: r.name,
                category: back.get((0, name_memory_util_1.nameKey)(r.name ?? '')) ?? r.offsetAccount,
                subNameId: null,
            }));
            await (0, sub_name_parents_1.fileUnderSubNames)(this.prisma, scope);
            await (0, sub_name_parents_1.dropUnusedSubName)(this.prisma, scope, oldSubId);
            return;
        }
        const sub = await this.prisma.subName.findUnique({
            where: { id: source.subNameId },
            select: { id: true, category: true },
        });
        if (!sub)
            return;
        const name = (0, name_memory_util_1.cleanName)(source.name);
        let ruleId = rule?.id;
        if (rule) {
            if (rule.subNameId !== sub.id ||
                rule.category !== sub.category ||
                rule.name !== name)
                await this.prisma.customerNameRule.update({
                    where: { id: rule.id },
                    data: { name, category: sub.category, subNameId: sub.id },
                });
        }
        else {
            const made = await this.prisma.customerNameRule.create({
                data: {
                    ...(0, scope_1.scopeWhere)(scope),
                    matchType: 'DESCRIPTION',
                    matchKey: key,
                    name,
                    category: sub.category,
                    subNameId: sub.id,
                },
                select: { id: true },
            });
            ruleId = made.id;
        }
        const rows = (await this.prisma.bankTransaction.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                splitOfId: null,
                manualEdit: false,
                splits: { none: {} },
            },
            select: MATCH_SELECT,
        })).filter((r) => (0, name_memory_util_1.descriptionKey)(r.description) === key);
        await this.writeRows(scope, rows.map(toMatched), () => ({
            name,
            category: sub.category,
            subNameId: sub.id,
            personalRuleId: ruleId ?? null,
        }));
        if (oldSubId !== null && oldSubId !== sub.id)
            await (0, sub_name_parents_1.dropUnusedSubName)(this.prisma, scope, oldSubId);
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
                    subNameId: true,
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
                    ruled.category !== r.offsetAccount ||
                    (ruled.subNameId !== null && ruled.subNameId !== r.subNameId);
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
                    ruleName: ruled.name ?? (r.manualEdit ? '' : null),
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
            await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, scope);
        }
        catch (err) {
            this.logger.warn(`provenance of ${(0, scope_1.bookLabel)(scope)} not updated: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async saveException(scope, key, existing, row) {
        if (existing?.id !== undefined) {
            if (existing.name !== row.name ||
                existing.category !== row.offsetAccount ||
                (existing.subNameId ?? null) !== row.subNameId) {
                await this.prisma.customerNameRule.update({
                    where: { id: existing.id },
                    data: {
                        name: row.name,
                        category: row.offsetAccount,
                        subNameId: row.subNameId,
                    },
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
                subNameId: row.subNameId,
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
        if (name && input.subNameId != null) {
            const sub = await this.subNameOf(scope, input.subNameId, name);
            if (editScope === 'ALWAYS') {
                await this.upsertRule(previous, { ...where, name, category: sub.category, subNameId: sub.id }, { name, category: sub.category, subNameId: sub.id });
            }
            const rows = await this.matchingRows(scope, 'DESCRIPTION', matchKey, new Set(), editScope === 'ONCE');
            await this.writeRows(scope, rows, () => ({ name, category: sub.category, subNameId: sub.id }), editScope === 'ONCE');
            return;
        }
        if (name) {
            const target = await this.categoryOfName(scope, name);
            if (editScope === 'ALWAYS') {
                await this.upsertRule(previous, { ...where, name }, { name, category: null, subNameId: null });
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
        await this.upsertRule(previous, { ...where, category }, { category, subNameId: null });
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
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    splitOfId: null,
                    statement: { deletedAt: null },
                },
                select: { description: true, name: true, manualEdit: true },
            }),
        ]);
        const ruled = (0, name_memory_util_1.findLinkConflicts)({
            matchType,
            key,
            name,
            rules,
            descriptions: [...new Set(rows.map((r) => r.description))],
        });
        const taken = new Set(ruled.map((c) => (0, name_memory_util_1.nameKey)(c.name)));
        const conflicts = [
            ...ruled,
            ...(0, name_memory_util_1.rowNameConflicts)({
                matchType,
                key,
                name,
                rows,
                rules,
                ignore: [reports_util_1.UNCLARIFIED_NAME],
            }).filter((c) => !taken.has((0, name_memory_util_1.nameKey)(c.name))),
        ];
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
            select: {
                ...MATCH_SELECT,
                manualEdit: true,
                splitOfId: true,
                ruleName: true,
            },
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
            if (name && name !== row.name && input.scope === 'ALWAYS') {
                const parent = await this.prisma.bankTransaction.findFirst({
                    where: { id: row.splitOfId, ...(0, scope_1.scopeWhere)(scope) },
                    select: { ...MATCH_SELECT, manualEdit: true },
                });
                const key = parent ? (0, name_memory_util_1.descriptionKey)(parent.description) : '';
                if (!parent || !key) {
                    throw new common_1.BadRequestException('This transaction has no description to remember. Apply the name to this split only.');
                }
                await this.guardLinks(scope, 'DESCRIPTION', key, name, input.replace);
                if (parent.manualEdit) {
                    await this.writeRows(scope, [toMatched(parent)], (r) => ({
                        name,
                        category: r.offsetAccount,
                    }));
                    await this.clearException(scope, parent.id);
                }
                await this.applyRule(scope, {
                    matchType: 'DESCRIPTION',
                    matchKey: key,
                    name,
                    category,
                    scope: 'ALWAYS',
                    replace: true,
                });
            }
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
                if (row.ruleName === null && !row.manualEdit) {
                    await this.prisma.bankTransaction.update({
                        where: { id: row.id },
                        data: { ruleName: row.name ?? '' },
                    });
                }
                await this.writeRows(scope, [matched], (r) => ({ name, category: r.offsetAccount, subNameId: null }), true);
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
        if (input.scope === 'ONCE') {
            const owner = (0, name_memory_util_1.cleanName)(row.name);
            const sub = owner
                ? await (0, sub_name_parents_1.ensureSubName)(this.prisma, scope, owner, category)
                : null;
            await this.writeRows(scope, [matched], (r) => ({ name: r.name, category, subNameId: sub?.id ?? null }), true);
            if (row.subNameId !== (sub?.id ?? null))
                await (0, sub_name_parents_1.dropUnusedSubName)(this.prisma, scope, row.subNameId);
            return;
        }
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
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                name: key,
                splitOfId: null,
                NOT: { subNameId: { not: null }, splits: { none: {} } },
            },
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
    async applyMerge(scope, from, into, sub) {
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
        const category = sub
            ? sub.category
            : ((await this.categoryOfName(scope, target)) ?? chart_of_accounts_1.UNCATEGORIZED);
        if (sub)
            await this.prisma.customerNameRule.updateMany({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    name: source,
                    matchType: { in: ['DESCRIPTION', 'CONTAINS'] },
                },
                data: { name: target, subNameId: sub.id, category: sub.category },
            });
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
        const ruleCategory = sub?.category ?? null;
        await this.upsertRule(previous, { ...where, name: target, category: ruleCategory }, { name: target, category: ruleCategory });
        await this.writeRows(scope, rows, () => ({
            name: target,
            category,
            ...(sub && { subNameId: sub.id }),
        }));
        if (!sub && category !== chart_of_accounts_1.UNCATEGORIZED)
            await this.setNameCategory(scope, target, category);
        if (sub) {
            const own = await this.prisma.ledgerName.findFirst({
                where: { ...(0, scope_1.scopeWhere)(scope), name: source },
                select: { fields: true },
            });
            await this.addFields(scope, own?.fields, { subNameId: sub.id });
        }
        else
            await this.tax.mergeNameFields(scope, source, target);
        await this.tax.moveNameFiles(scope, [source], sub?.name ?? target);
        await this.tax.moveSubNames(scope, [source], target);
        await this.prisma.ledgerNameAgency.deleteMany({
            where: { ...(0, scope_1.scopeWhere)(scope), name: source },
        });
        const own = await this.prisma.ledgerName.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), name: source },
            select: { id: true },
        });
        if (own &&
            (await this.prisma.customColumnNameAnswer.count({
                where: { nameId: own.id },
            })))
            await (0, custom_column_defaults_1.moveNameAnswers)(this.prisma, { nameId: own.id }, sub
                ? { subNameId: sub.id }
                : { nameId: await (0, sub_name_parents_1.ledgerNameId)(this.prisma, scope, target) }, true);
        await this.prisma.ledgerName.deleteMany({
            where: { ...(0, scope_1.scopeWhere)(scope), name: source },
        });
        this.logger.log(`book ${(0, scope_1.bookLabel)(scope)}: merged name "${source}" into "${sub?.name ?? target}" (${rows.length} rows)`);
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
    async subNameOf(scope, id, name) {
        const sub = await this.prisma.subName.findFirst({
            where: { id, bookId: scope.bookId, customerId: scope.customerId },
            select: { id: true, nameId: true, category: true },
        });
        const parent = sub
            ? await this.prisma.ledgerName.findUnique({
                where: { id: sub.nameId },
                select: { name: true },
            })
            : null;
        if (!sub || !parent || (0, name_memory_util_1.nameKey)(parent.name) !== (0, name_memory_util_1.nameKey)(name))
            throw new common_1.BadRequestException(`That is not a sub-name of “${name}”.`);
        return sub;
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
            const subChanged = out.subNameId !== undefined && out.subNameId !== row.subNameId;
            const ruleChanged = out.personalRuleId !== undefined &&
                row.personalRuleId !== undefined &&
                out.personalRuleId !== row.personalRuleId;
            if (name === row.name &&
                category === row.offsetAccount &&
                !subChanged &&
                !ruleChanged)
                return [];
            const bank = row.amount < 0 ? row.creditAccount : row.debitAccount;
            return [
                this.prisma.bankTransaction.update({
                    where: { id: row.id },
                    data: {
                        name,
                        offsetAccount: category,
                        ...(0, ledger_util_1.doubleEntry)(row.amount, bank, category),
                        ...(out.subNameId !== undefined && { subNameId: out.subNameId }),
                        ...(out.personalRuleId !== undefined && {
                            personalRuleId: out.personalRuleId,
                        }),
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
    subNameId: true,
    personalRuleId: true,
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
        subNameId: r.subNameId ?? null,
        personalRuleId: r.personalRuleId ?? null,
    };
}
//# sourceMappingURL=name-memory.service.js.map