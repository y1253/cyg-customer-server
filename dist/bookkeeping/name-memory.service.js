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
const name_memory_util_1 = require("./name-memory.util");
let NameMemoryService = NameMemoryService_1 = class NameMemoryService {
    prisma;
    logger = new common_1.Logger(NameMemoryService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async contextFor(customerId, descriptions) {
        const keys = [...new Set(descriptions.map(name_memory_util_1.descriptionKey).filter(Boolean))];
        const [memoryRows, rules] = await Promise.all([
            keys.length
                ? this.prisma.descriptionMemory.findMany({
                    where: { descriptionKey: { in: keys } },
                    select: { descriptionKey: true, name: true, category: true },
                })
                : Promise.resolve([]),
            this.rulesOf(customerId),
        ]);
        const memory = new Map(memoryRows.map((m) => [
            m.descriptionKey,
            { name: m.name, category: m.category },
        ]));
        return { memory, ...(0, name_memory_util_1.indexRules)(rules) };
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
    async resolveStatement(customerId, rows) {
        try {
            const ctx = await this.contextFor(customerId, rows.map((r) => r.description));
            const resolved = rows.map((r) => {
                const out = (0, name_memory_util_1.resolveRow)(r, ctx);
                return { ...r, name: out.name, offsetAccount: out.category };
            });
            await this.learn(rows, ctx.memory);
            return resolved;
        }
        catch (err) {
            this.logger.warn(`name memory unavailable for customer ${customerId}, keeping the AI's answers: ${String(err)}`);
            return rows;
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
    async saveRule(customerId, input) {
        const matchKey = input.matchType === 'NAME'
            ? (0, name_memory_util_1.nameKey)(input.matchKey)
            : (0, name_memory_util_1.descriptionKey)(input.matchKey) || input.matchKey.trim().toLowerCase();
        const name = (0, name_memory_util_1.cleanName)(input.name);
        const category = input.category ? (0, chart_of_accounts_1.normalizeAccount)(input.category) : null;
        const where = {
            customerId_matchType_matchKey: {
                customerId,
                matchType: input.matchType,
                matchKey,
            },
        };
        const previous = await this.prisma.customerNameRule.findUnique({ where });
        await this.prisma.customerNameRule.upsert({
            where,
            create: {
                customerId,
                matchType: input.matchType,
                matchKey,
                name,
                category,
            },
            update: { name, category },
        });
        const names = new Set([matchKey]);
        if (previous?.name)
            names.add((0, name_memory_util_1.nameKey)(previous.name));
        await this.rewrite(customerId, input.matchType, matchKey, names, (row) => ({
            name: name ?? row.name,
            category: category ?? row.offsetAccount,
        }));
        if (name && input.matchType === 'NAME') {
            await this.carryTaxSwitch(customerId, [...names], name);
        }
    }
    async resetRule(customerId, input) {
        const matchKey = input.matchType === 'NAME'
            ? (0, name_memory_util_1.nameKey)(input.matchKey)
            : (0, name_memory_util_1.descriptionKey)(input.matchKey) || input.matchKey.trim().toLowerCase();
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
        const rows = await this.matchingRows(customerId, input.matchType, matchKey, names);
        if (!rows.length)
            return;
        const ctx = await this.contextFor(customerId, rows.map((r) => r.description));
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
    async rewrite(customerId, matchType, matchKey, names, next) {
        const rows = await this.matchingRows(customerId, matchType, matchKey, names);
        await this.writeRows(customerId, rows, next);
    }
    async matchingRows(customerId, matchType, matchKey, names) {
        const select = {
            id: true,
            description: true,
            name: true,
            amount: true,
            offsetAccount: true,
            debitAccount: true,
            creditAccount: true,
        };
        if (matchType === 'NAME') {
            const rows = await this.prisma.bankTransaction.findMany({
                where: { customerId, name: { in: [...names] } },
                select,
            });
            return rows.map(toMatched);
        }
        const rows = await this.prisma.bankTransaction.findMany({
            where: { customerId },
            select,
        });
        return rows
            .filter((r) => (0, name_memory_util_1.descriptionKey)(r.description) === matchKey)
            .map(toMatched);
    }
    async writeRows(customerId, rows, next) {
        const updates = rows.flatMap((row) => {
            const { name, category } = next(row);
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
                    },
                }),
            ];
        });
        if (!updates.length)
            return;
        await this.prisma.$transaction([
            ...updates,
            this.prisma.customer.update({
                where: { id: customerId },
                data: { taxStale: true },
            }),
        ]);
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
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], NameMemoryService);
function originalName(current, matchKey) {
    if (current && (0, name_memory_util_1.nameKey)(current) === matchKey)
        return current;
    return matchKey.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
function toMatched(r) {
    return { ...r, amount: Number(r.amount.toString()) };
}
//# sourceMappingURL=name-memory.service.js.map