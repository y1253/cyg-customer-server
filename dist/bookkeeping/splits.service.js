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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SplitsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const customer_accounts_service_1 = require("./customer-accounts.service");
const ledger_util_1 = require("./ledger.util");
const name_memory_util_1 = require("./name-memory.util");
const product_memory_service_1 = require("./product-memory.service");
const receipt_items_util_1 = require("./receipt-items.util");
const scope_1 = require("./scope");
const splits_util_1 = require("./splits.util");
const tax_service_1 = require("./tax.service");
let SplitsService = class SplitsService {
    prisma;
    accounts;
    tax;
    products;
    constructor(prisma, accounts, tax, products) {
        this.prisma = prisma;
        this.accounts = accounts;
        this.tax = tax;
        this.products = products;
    }
    async save(scope, id, input) {
        const parent = await this.prisma.bankTransaction.findFirst({
            where: {
                id,
                ...(0, scope_1.scopeWhere)(scope),
                statement: { deletedAt: null, status: client_1.StatementStatus.DONE },
            },
            include: { splits: { select: { id: true } } },
        });
        if (!parent)
            throw new common_1.NotFoundException('Transaction not found');
        if (parent.splitOfId) {
            throw new common_1.BadRequestException('This is already a split. Split the transaction it came from instead.');
        }
        const amount = Number(parent.amount);
        const problem = (0, splits_util_1.splitProblem)(amount, input.map((s) => s.amount));
        if (problem)
            throw new common_1.BadRequestException(problem);
        const existing = new Set(parent.splits.map((s) => s.id));
        for (const s of input) {
            if (s.id != null && !existing.has(s.id)) {
                throw new common_1.BadRequestException('A split was removed meanwhile. Reload.');
            }
        }
        const rows = await Promise.all(input.map(async (s) => ({
            id: s.id,
            name: (0, name_memory_util_1.cleanName)(s.name ?? null),
            itemName: (0, name_memory_util_1.cleanName)(s.itemName ?? null),
            always: s.always === true,
            category: await this.accounts.validCategory(scope, s.category),
            amount: (0, splits_util_1.signedLike)(amount, s.amount),
        })));
        const bank = amount < 0 ? parent.creditAccount : parent.debitAccount;
        const keep = new Set(rows.flatMap((r) => (r.id != null ? [r.id] : [])));
        await this.prisma.$transaction(async (tx) => {
            await tx.bankTransaction.deleteMany({
                where: { splitOfId: parent.id, id: { notIn: [...keep] } },
            });
            const out = [];
            for (const r of rows) {
                const data = {
                    name: r.name,
                    itemName: r.itemName,
                    amount: r.amount.toFixed(2),
                    offsetAccount: r.category,
                    ...(0, ledger_util_1.doubleEntry)(r.amount, bank, r.category),
                };
                if (r.id != null) {
                    await tx.bankTransaction.update({ where: { id: r.id }, data });
                    out.push(r.id);
                }
                else {
                    const made = await tx.bankTransaction.create({
                        data: {
                            ...data,
                            statementId: parent.statementId,
                            ...(0, scope_1.scopeWhere)(scope),
                            position: parent.position,
                            pendingDate: parent.pendingDate,
                            postingDate: parent.postingDate,
                            description: parent.description,
                            manualEdit: true,
                            splitOfId: parent.id,
                        },
                        select: { id: true },
                    });
                    out.push(made.id);
                }
            }
            return out;
        });
        for (const r of rows) {
            if (r.always && r.itemName && (0, receipt_items_util_1.itemKey)(r.itemName)) {
                await this.products.saveRule(scope, r.itemName, r.category);
            }
        }
    }
};
exports.SplitsService = SplitsService;
exports.SplitsService = SplitsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        customer_accounts_service_1.CustomerAccountsService,
        tax_service_1.TaxService,
        product_memory_service_1.ProductMemoryService])
], SplitsService);
//# sourceMappingURL=splits.service.js.map