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
const name_memory_service_1 = require("./name-memory.service");
const name_memory_util_1 = require("./name-memory.util");
const product_memory_service_1 = require("./product-memory.service");
const receipt_items_util_1 = require("./receipt-items.util");
const scope_1 = require("./scope");
const splits_util_1 = require("./splits.util");
const sub_names_service_1 = require("./sub-names.service");
const sub_name_parents_1 = require("./sub-name-parents");
const tax_service_1 = require("./tax.service");
const DONE_STATEMENT = { deletedAt: null, status: client_1.StatementStatus.DONE };
let SplitsService = class SplitsService {
    prisma;
    accounts;
    tax;
    products;
    names;
    subNames;
    constructor(prisma, accounts, tax, products, names, subNames) {
        this.prisma = prisma;
        this.accounts = accounts;
        this.tax = tax;
        this.products = products;
        this.names = names;
        this.subNames = subNames;
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
        const rows = await Promise.all(input.map(async (s) => {
            const category = await this.accounts.validCategory(scope, s.category);
            return {
                id: s.id,
                name: (0, name_memory_util_1.fallbackName)((0, name_memory_util_1.cleanName)(s.name ?? null) ?? parent.name, category, parent.description),
                itemName: (0, name_memory_util_1.cleanName)(s.itemName ?? null),
                always: s.always === true,
                category,
                amount: (0, splits_util_1.signedLike)(amount, s.amount),
            };
        }));
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
                    ...(0, ledger_util_1.doubleEntry)(amount, bank, r.category),
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
        await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, scope, [id]);
    }
    async duplicate(scope, id) {
        const row = await this.prisma.bankTransaction.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), statement: DONE_STATEMENT },
        });
        if (!row)
            throw new common_1.NotFoundException('Transaction not found');
        const parent = row.splitOfId
            ? await this.prisma.bankTransaction.findFirst({
                where: { id: row.splitOfId, ...(0, scope_1.scopeWhere)(scope) },
            })
            : row;
        if (!parent)
            throw new common_1.NotFoundException('Transaction not found');
        const amount = Number(parent.amount);
        if (amount === 0) {
            throw new common_1.BadRequestException('A $0.00 transaction cannot be split');
        }
        const count = await this.prisma.bankTransaction.count({
            where: { splitOfId: parent.id },
        });
        if (count >= 50) {
            throw new common_1.BadRequestException('A transaction can have at most 50 splits');
        }
        const bank = amount < 0 ? parent.creditAccount : parent.debitAccount;
        const category = row.offsetAccount;
        const made = await this.prisma.bankTransaction.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                statementId: parent.statementId,
                position: parent.position,
                pendingDate: parent.pendingDate,
                postingDate: parent.postingDate,
                description: parent.description,
                name: (0, name_memory_util_1.fallbackName)(row.name, category, parent.description),
                itemName: row.itemName,
                subNameId: row.splitOfId ? row.subNameId : null,
                amount: '0.00',
                offsetAccount: category,
                ...(0, ledger_util_1.doubleEntry)(amount, bank, category),
                manualEdit: true,
                splitOfId: parent.id,
            },
            select: { id: true },
        });
        await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, scope, [parent.id]);
        return made;
    }
    async edit(scope, id, input) {
        const split = await this.findSplit(scope, id);
        const parent = split.splitOf;
        const parentAmount = Number(parent.amount);
        const bank = parentAmount < 0 ? parent.creditAccount : parent.debitAccount;
        if (input.amount !== undefined) {
            const others = await this.prisma.bankTransaction.findMany({
                where: { splitOfId: parent.id, id: { not: id } },
                select: { amount: true },
            });
            const problem = (0, splits_util_1.splitProblem)(parentAmount, [
                ...others.map((o) => Math.abs(Number(o.amount))),
                input.amount,
            ]);
            if (problem)
                throw new common_1.BadRequestException(problem);
            const amount = (0, splits_util_1.signedLike)(parentAmount, input.amount);
            await this.prisma.bankTransaction.update({
                where: { id },
                data: {
                    amount: amount.toFixed(2),
                    ...(0, ledger_util_1.doubleEntry)(parentAmount, bank, split.offsetAccount),
                },
            });
        }
        if (input.itemName !== undefined) {
            await this.prisma.bankTransaction.update({
                where: { id },
                data: { itemName: (0, name_memory_util_1.cleanName)(input.itemName) },
            });
        }
        const name = (0, name_memory_util_1.cleanName)(input.name ?? null);
        if (name && name.toLowerCase() !== (split.name ?? '').toLowerCase()) {
            await this.names.editTransaction(scope, id, {
                name,
                category: null,
                scope: input.nameScope ?? 'ONCE',
                replace: input.replace,
            });
            const own = input.category
                ? null
                : await this.names.categoryOfName(scope, name);
            await this.setCategory(scope, id, own, null);
        }
        if (input.category) {
            const category = await this.accounts.validCategory(scope, input.category);
            const current = await this.findSplit(scope, id);
            const owner = (0, name_memory_util_1.cleanName)(current.name);
            const ofName = owner
                ? await this.names.categoryOfName(scope, owner)
                : null;
            if (owner && input.categoryScope === 'ALL') {
                await this.names.setCategoryOfName(scope, owner, category);
                await this.setCategory(scope, id, category, null);
            }
            else if (!owner || category === ofName) {
                await this.setCategory(scope, id, category, null);
            }
            else {
                const sub = await this.subNames.ensure(scope, owner, category);
                await this.setCategory(scope, id, category, sub.id);
            }
        }
        const itemName = input.itemName !== undefined
            ? (0, name_memory_util_1.cleanName)(input.itemName)
            : (0, name_memory_util_1.cleanName)(split.itemName);
        if (input.always && itemName && (0, receipt_items_util_1.itemKey)(itemName)) {
            const after = await this.findSplit(scope, id);
            await this.products.saveRule(scope, itemName, after.offsetAccount);
        }
        await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, scope, [parent.id]);
    }
    async remove(scope, id) {
        const split = await this.findSplit(scope, id);
        await this.prisma.bankTransaction.delete({ where: { id } });
        await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, scope, [split.splitOfId]);
    }
    async setProduct(scope, id, itemName) {
        const row = await this.prisma.bankTransaction.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), statement: DONE_STATEMENT },
            select: { id: true },
        });
        if (!row)
            throw new common_1.NotFoundException('Transaction not found');
        await this.prisma.bankTransaction.update({
            where: { id },
            data: { itemName: (0, name_memory_util_1.cleanName)(itemName) },
        });
    }
    async findSplit(scope, id) {
        const split = await this.prisma.bankTransaction.findFirst({
            where: {
                id,
                ...(0, scope_1.scopeWhere)(scope),
                splitOfId: { not: null },
                statement: DONE_STATEMENT,
            },
            include: { splitOf: true },
        });
        if (!split?.splitOf)
            throw new common_1.NotFoundException('Split not found');
        return split;
    }
    async setCategory(scope, id, category, subNameId) {
        const split = await this.findSplit(scope, id);
        const parentAmount = Number(split.splitOf.amount);
        const bank = parentAmount < 0
            ? split.splitOf.creditAccount
            : split.splitOf.debitAccount;
        const offset = category ?? split.offsetAccount;
        await this.prisma.bankTransaction.update({
            where: { id },
            data: {
                offsetAccount: offset,
                ...(0, ledger_util_1.doubleEntry)(parentAmount, bank, offset),
                subNameId,
                name: (0, name_memory_util_1.fallbackName)(split.name, offset, split.description),
            },
        });
    }
};
exports.SplitsService = SplitsService;
exports.SplitsService = SplitsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        customer_accounts_service_1.CustomerAccountsService,
        tax_service_1.TaxService,
        product_memory_service_1.ProductMemoryService,
        name_memory_service_1.NameMemoryService,
        sub_names_service_1.SubNamesService])
], SplitsService);
//# sourceMappingURL=splits.service.js.map