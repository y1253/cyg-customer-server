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
const tax_service_1 = require("./tax.service");
const name_memory_util_1 = require("./name-memory.util");
let NameMemoryService = NameMemoryService_1 = class NameMemoryService {
    prisma;
    tax;
    logger = new common_1.Logger(NameMemoryService_1.name);
    constructor(prisma, tax) {
        this.prisma = prisma;
        this.tax = tax;
    }
    async contextFor(customerId, descriptions, names = []) {
        const keys = [...new Set(descriptions.map(name_memory_util_1.descriptionKey).filter(Boolean))];
        const [memoryRows, rules, customAccounts] = await Promise.all([
            keys.length
                ? this.prisma.descriptionMemory.findMany({
                    where: { descriptionKey: { in: keys } },
                    select: { descriptionKey: true, name: true, category: true },
                })
                : Promise.resolve([]),
            this.rulesOf(customerId),
            this.customAccountsOf(customerId),
        ]);
        const memory = new Map(memoryRows.map((m) => [
            m.descriptionKey,
            { name: m.name, category: m.category },
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
        return { memory, ...(0, name_memory_util_1.indexRules)(rules), customAccounts, nameMemory };
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
    async rulesOf(customerId) {
        const rows = await this.prisma.customerNameRule.findMany({
            where: { customerId },
            select: { matchType: true, matchKey: true, name: true, category: true },
        });
        return rows.map((r) => ({
            ...r,
            matchType: r.matchType === 'DESCRIPTION' ? 'DESCRIPTION' : 'NAME',
        }));
    }
    async customAccountsOf(customerId) {
        const rows = await this.prisma.customerAccount.findMany({
            where: { customerId },
            select: { name: true },
        });
        return new Set(rows.map((r) => r.name));
    }
    async resolveStatement(customerId, rows, bankName = null) {
        try {
            const ctx = {
                ...(await this.contextFor(customerId, rows.map((r) => r.description), rows.map((r) => r.name))),
                bankName,
            };
            const { resolved } = (0, name_memory_util_1.resolveRows)(rows, ctx);
            const lines = rows.map((r, i) => ({
                ...r,
                name: resolved[i].name,
                offsetAccount: resolved[i].category,
            }));
            await this.learn(rows, ctx.memory);
            await this.learnNames(resolved, ctx.nameMemory ?? new Map());
            return { lines, customAccounts: ctx.customAccounts };
        }
        catch (err) {
            this.logger.warn(`name memory unavailable for customer ${customerId}, keeping the AI's answers: ${String(err)}`);
            const bank = (0, name_memory_util_1.bankPayeeName)(bankName);
            const lines = rows.map((r) => {
                let out = r;
                if (bank && !(0, name_memory_util_1.cleanName)(r.name) && (0, name_memory_util_1.isBankCharge)(r.offsetAccount)) {
                    out = { ...out, name: bank };
                }
                if ((0, name_memory_util_1.isOwnersLoanMove)(r.description, r.offsetAccount)) {
                    out = { ...out, offsetAccount: chart_of_accounts_1.OWNERS_LOAN };
                }
                return out;
            });
            return { lines, customAccounts: new Set() };
        }
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
    async saveRule(customerId, input) {
        const matchKey = ruleKeyOf(input.matchType, input.matchKey);
        const name = (0, name_memory_util_1.cleanName)(input.name);
        const category = input.category
            ? (0, chart_of_accounts_1.normalizeAccount)(input.category, await this.customAccountsOf(customerId))
            : null;
        const where = {
            customerId_matchType_matchKey: {
                customerId,
                matchType: input.matchType,
                matchKey,
            },
        };
        const previous = await this.prisma.customerNameRule.findUnique({ where });
        if (input.matchType === 'NAME') {
            const names = new Set([matchKey]);
            if (previous?.name)
                names.add((0, name_memory_util_1.nameKey)(previous.name));
            if (!name) {
                if (category) {
                    await this.setNameCategory(customerId, (0, name_memory_util_1.cleanName)(previous?.name) ?? matchKey, category);
                }
                return;
            }
            const target = await this.categoryOfName(customerId, name);
            await this.prisma.customerNameRule.upsert({
                where,
                create: { customerId, matchType: 'NAME', matchKey, name },
                update: { name },
            });
            const rows = await this.matchingRows(customerId, 'NAME', matchKey, names, false);
            await this.writeRows(customerId, rows, (row) => ({
                name,
                category: row.offsetAccount,
            }));
            await this.carryTaxSwitch(customerId, [...names], name);
            const adopt = category ?? target;
            if (adopt)
                await this.setNameCategory(customerId, name, adopt);
            return;
        }
        const scope = input.scope ?? 'ALWAYS';
        if (name) {
            const target = await this.categoryOfName(customerId, name);
            if (scope === 'ALWAYS') {
                await this.prisma.customerNameRule.upsert({
                    where,
                    create: { customerId, matchType: 'DESCRIPTION', matchKey, name },
                    update: { name, category: null },
                });
            }
            const rows = await this.matchingRows(customerId, 'DESCRIPTION', matchKey, new Set(), scope === 'ONCE');
            await this.writeRows(customerId, rows, (row) => ({ name, category: row.offsetAccount }), scope === 'ONCE');
            const adopt = category ?? target;
            if (adopt)
                await this.setNameCategory(customerId, name, adopt);
            return;
        }
        if (!category)
            return;
        await this.prisma.customerNameRule.upsert({
            where,
            create: { customerId, matchType: 'DESCRIPTION', matchKey, category },
            update: { category },
        });
        const rows = await this.matchingRows(customerId, 'DESCRIPTION', matchKey, new Set(), true);
        await this.writeRows(customerId, rows.filter((r) => !(0, name_memory_util_1.cleanName)(r.name)), () => ({ name: null, category }));
    }
    async editTransaction(customerId, id, input) {
        const row = await this.prisma.bankTransaction.findFirst({
            where: { id, customerId },
            select: { ...MATCH_SELECT, manualEdit: true, splitOfId: true },
        });
        if (!row)
            throw new common_1.NotFoundException('Transaction not found');
        const custom = await this.customAccountsOf(customerId);
        const name = (0, name_memory_util_1.cleanName)(input.name);
        const category = input.category
            ? (0, chart_of_accounts_1.normalizeAccount)(input.category, custom)
            : null;
        const matched = toMatched(row);
        if (row.splitOfId) {
            await this.writeRows(customerId, [matched], (r) => ({
                name: name ?? r.name,
                category: category ?? r.offsetAccount,
            }), true);
            return;
        }
        const key = (0, name_memory_util_1.descriptionKey)(row.description);
        if (name && name !== row.name) {
            if (input.scope === 'ONCE') {
                const target = await this.categoryOfName(customerId, name);
                await this.writeRows(customerId, [matched], (r) => ({ name, category: r.offsetAccount }), true);
                const adopt = category ?? target;
                if (adopt)
                    await this.setNameCategory(customerId, name, adopt);
                return;
            }
            if (!key) {
                throw new common_1.BadRequestException('This transaction has no description to remember. Apply the name to this row only.');
            }
            if (row.manualEdit) {
                await this.writeRows(customerId, [matched], (r) => ({
                    name,
                    category: r.offsetAccount,
                }));
            }
            await this.saveRule(customerId, {
                matchType: 'DESCRIPTION',
                matchKey: key,
                name,
                category,
                scope: 'ALWAYS',
            });
            return;
        }
        if (!category)
            return;
        const current = (0, name_memory_util_1.cleanName)(row.name);
        if (current) {
            await this.setNameCategory(customerId, current, category);
        }
        else if (key) {
            await this.saveRule(customerId, {
                matchType: 'DESCRIPTION',
                matchKey: key,
                name: null,
                category,
            });
        }
        else {
            await this.writeRows(customerId, [matched], (r) => ({ name: r.name, category }), true);
        }
    }
    async setNameCategory(customerId, name, category) {
        const key = (0, name_memory_util_1.nameKey)(name);
        const rules = await this.prisma.customerNameRule.findMany({
            where: { customerId, matchType: 'NAME' },
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
                data: { customerId, matchType: 'NAME', matchKey: key, category },
            });
        }
        const rows = await this.prisma.bankTransaction.findMany({
            where: { customerId, name: key, splitOfId: null },
            select: MATCH_SELECT,
        });
        await this.writeRows(customerId, rows.map(toMatched), (r) => ({
            name: r.name,
            category,
        }));
    }
    async categoryOfName(customerId, name) {
        const key = (0, name_memory_util_1.nameKey)(name);
        const own = (0, name_memory_util_1.indexRules)(await this.rulesOf(customerId)).nameCategories.get(key);
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
            where: { customerId, name: key, splitOfId: null },
            _count: { _all: true },
        });
        const usual = groups
            .filter((g) => g.offsetAccount !== chart_of_accounts_1.UNCATEGORIZED)
            .sort((a, b) => b._count._all - a._count._all)[0];
        return usual?.offsetAccount ?? null;
    }
    async ruleKeyForName(customerId, name) {
        const key = (0, name_memory_util_1.nameKey)(name);
        const rules = await this.prisma.customerNameRule.findMany({
            where: { customerId, matchType: 'NAME' },
            select: { matchKey: true, name: true },
        });
        const hit = rules.find((r) => r.matchKey === key || (r.name && (0, name_memory_util_1.nameKey)(r.name) === key));
        return hit?.matchKey ?? key;
    }
    async resetRule(customerId, input) {
        const matchKey = ruleKeyOf(input.matchType, input.matchKey);
        const where = {
            customerId_matchType_matchKey: {
                customerId,
                matchType: input.matchType,
                matchKey,
            },
        };
        const rule = await this.prisma.customerNameRule.findUnique({ where });
        if (!rule)
            throw new common_1.NotFoundException('That name has no saved change');
        await this.prisma.customerNameRule.delete({ where });
        const names = new Set([matchKey]);
        if (rule.name)
            names.add((0, name_memory_util_1.nameKey)(rule.name));
        const rows = await this.matchingRows(customerId, input.matchType, matchKey, names, false);
        if (!rows.length)
            return;
        const ctx = await this.contextFor(customerId, rows.map((r) => r.description), rows.map((r) => r.name));
        await this.writeRows(customerId, rows, (row) => {
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
    async matchingRows(customerId, matchType, matchKey, names, includeManual) {
        const manual = includeManual
            ? { splitOfId: null }
            : { manualEdit: false, splitOfId: null };
        if (matchType === 'NAME') {
            const rows = await this.prisma.bankTransaction.findMany({
                where: { customerId, name: { in: [...names] }, ...manual },
                select: MATCH_SELECT,
            });
            return rows.map(toMatched);
        }
        const rows = await this.prisma.bankTransaction.findMany({
            where: { customerId, ...manual },
            select: MATCH_SELECT,
        });
        return rows
            .filter((r) => (0, name_memory_util_1.descriptionKey)(r.description) === matchKey)
            .map(toMatched);
    }
    async writeRows(customerId, rows, next, manual = false) {
        const changed = [];
        const updates = rows.flatMap((row) => {
            const { name, category } = next(row);
            if (name === row.name && category === row.offsetAccount)
                return [];
            changed.push(row.id);
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
        await this.tax.retagRows(customerId, changed);
    }
    async carryTaxSwitch(customerId, oldNames, newName) {
        const exempt = await this.prisma.ledgerName.findFirst({
            where: { customerId, name: { in: oldNames }, taxExempt: true },
            select: { id: true },
        });
        if (!exempt)
            return;
        await this.prisma.ledgerName.upsert({
            where: { customerId_name: { customerId, name: newName } },
            create: { customerId, name: newName, taxExempt: true },
            update: { taxExempt: true },
        });
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