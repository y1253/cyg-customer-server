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
var ProductMemoryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductMemoryService = void 0;
const common_1 = require("@nestjs/common");
const rules_service_1 = require("../assistant/rules.service");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const customer_accounts_service_1 = require("./customer-accounts.service");
const ledger_util_1 = require("./ledger.util");
const product_categorizer_1 = require("./product-categorizer");
const product_memory_util_1 = require("./product-memory.util");
const receipt_items_util_1 = require("./receipt-items.util");
const scope_1 = require("./scope");
const tax_service_1 = require("./tax.service");
let ProductMemoryService = ProductMemoryService_1 = class ProductMemoryService {
    prisma;
    accounts;
    categorizer;
    tax;
    rules;
    logger = new common_1.Logger(ProductMemoryService_1.name);
    constructor(prisma, accounts, categorizer, tax, rules) {
        this.prisma = prisma;
        this.accounts = accounts;
        this.categorizer = categorizer;
        this.tax = tax;
        this.rules = rules;
    }
    async categoriesFor(scope, names, context) {
        const fallback = () => context.parentCategory;
        try {
            const keys = [...new Set(names.map(receipt_items_util_1.itemKey).filter(Boolean))];
            const [rules, memory] = await Promise.all([
                this.itemRules(scope),
                this.memoryFor(keys),
            ]);
            const ask = (0, product_memory_util_1.itemsToAsk)(names, rules, memory);
            if (ask.length && this.categorizer.configured) {
                try {
                    const answers = await this.categorizer.categorize(ask, {
                        store: context.store,
                        category: context.parentCategory,
                        rules: (await this.rules?.promptBlock(scope, 'CATEGORY')) ?? '',
                    });
                    const named = ask.flatMap((a) => {
                        const category = answers.get(a.key);
                        return category ? [{ ...a, category }] : [];
                    });
                    await this.learn(named, memory);
                    for (const w of named)
                        memory.set(w.key, w.category);
                }
                catch (err) {
                    this.logger.warn(`item categories for ${(0, scope_1.bookLabel)(scope)} failed: ${err.message}`);
                }
            }
            const reused = keys.filter((k) => !rules.has(k) && !ask.some((a) => a.key === k) && memory.has(k));
            if (reused.length) {
                await this.prisma.productMemory.updateMany({
                    where: { itemKey: { in: reused } },
                    data: { hits: { increment: 1 } },
                });
            }
            return (name) => (0, product_memory_util_1.resolveItem)((0, receipt_items_util_1.itemKey)(name), rules, memory, context.parentCategory)
                .category;
        }
        catch (err) {
            this.logger.error(`item memory for ${(0, scope_1.bookLabel)(scope)} failed: ${err.message}`);
            return fallback;
        }
    }
    async itemRules(scope) {
        const rules = await this.prisma.customerItemRule.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { itemKey: true, category: true },
        });
        return new Map(rules.map((r) => [r.itemKey, r.category]));
    }
    async products(scope) {
        const rows = await this.itemRows(scope);
        const keys = [...new Set(rows.map((r) => (0, receipt_items_util_1.itemKey)(r.itemName)))];
        const [rules, memory] = await Promise.all([
            this.itemRules(scope),
            this.memoryFor(keys),
        ]);
        return (0, product_memory_util_1.groupProducts)(rows, rules, memory);
    }
    async saveRule(scope, rawKey, rawCategory) {
        const key = (0, receipt_items_util_1.itemKey)(rawKey) || rawKey.trim().toLowerCase().slice(0, 191);
        if (!key)
            throw new common_1.NotFoundException('That product has no name');
        const category = await this.accounts.validCategory(scope, rawCategory);
        const existing = await this.prisma.customerItemRule.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), itemKey: key },
            select: { id: true },
        });
        if (existing) {
            await this.prisma.customerItemRule.update({
                where: { id: existing.id },
                data: { category },
            });
        }
        else {
            await this.prisma.customerItemRule.create({
                data: { ...(0, scope_1.scopeWhere)(scope), itemKey: key, category },
            });
        }
        const rows = (await this.itemRows(scope)).filter((r) => (0, receipt_items_util_1.itemKey)(r.itemName) === key);
        await this.writeRows(scope, rows, () => category);
    }
    async resetRule(scope, rawKey) {
        const key = (0, receipt_items_util_1.itemKey)(rawKey) || rawKey.trim().toLowerCase();
        const where = { ...(0, scope_1.scopeWhere)(scope), itemKey: key };
        const rule = await this.prisma.customerItemRule.findFirst({ where });
        if (!rule)
            throw new common_1.NotFoundException('That product has no saved category');
        await this.prisma.customerItemRule.deleteMany({ where });
        const rows = (await this.itemRows(scope)).filter((r) => (0, receipt_items_util_1.itemKey)(r.itemName) === key);
        const memory = await this.memoryFor([key]);
        await this.writeRows(scope, rows, (r) => (0, product_memory_util_1.resolveItem)(key, new Map(), memory, r.parentCategory).category);
    }
    async memoryFor(keys) {
        if (!keys.length)
            return new Map();
        const found = await this.prisma.productMemory.findMany({
            where: { itemKey: { in: [...keys] } },
            select: { itemKey: true, category: true },
        });
        return new Map(found.map((m) => [m.itemKey, m.category]));
    }
    async learn(answers, memory) {
        const { creates, fills } = (0, product_memory_util_1.productMemoryWrites)(answers, memory);
        if (creates.length) {
            await this.prisma.productMemory.createMany({
                data: creates,
                skipDuplicates: true,
            });
        }
        for (const f of fills) {
            await this.prisma.productMemory.update({
                where: { itemKey: f.itemKey },
                data: { category: f.category },
            });
        }
    }
    async itemRows(scope) {
        const rows = await this.prisma.bankTransaction.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                splitOfId: { not: null },
                itemName: { not: null },
                statement: { deletedAt: null, status: client_1.StatementStatus.DONE },
            },
            select: {
                id: true,
                itemName: true,
                amount: true,
                offsetAccount: true,
                debitAccount: true,
                creditAccount: true,
                splitOf: { select: { offsetAccount: true } },
            },
        });
        return rows.map((r) => ({
            id: r.id,
            itemName: r.itemName ?? '',
            amount: Number(r.amount),
            offsetAccount: r.offsetAccount,
            debitAccount: r.debitAccount,
            creditAccount: r.creditAccount,
            parentCategory: r.splitOf?.offsetAccount ?? r.offsetAccount,
        }));
    }
    async writeRows(scope, rows, next) {
        const updates = rows.flatMap((row) => {
            const category = next(row);
            if (category === row.offsetAccount)
                return [];
            const bank = row.amount < 0 ? row.creditAccount : row.debitAccount;
            return [
                this.prisma.bankTransaction.update({
                    where: { id: row.id },
                    data: {
                        offsetAccount: category,
                        ...(0, ledger_util_1.doubleEntry)(row.amount, bank, category),
                    },
                }),
            ];
        });
        if (!updates.length)
            return;
        await this.prisma.$transaction(updates);
    }
};
exports.ProductMemoryService = ProductMemoryService;
exports.ProductMemoryService = ProductMemoryService = ProductMemoryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        customer_accounts_service_1.CustomerAccountsService,
        product_categorizer_1.ProductCategorizer,
        tax_service_1.TaxService,
        rules_service_1.RulesService])
], ProductMemoryService);
//# sourceMappingURL=product-memory.service.js.map