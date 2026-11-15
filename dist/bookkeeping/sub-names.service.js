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
exports.SubNamesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const customer_accounts_service_1 = require("./customer-accounts.service");
const ledger_util_1 = require("./ledger.util");
const name_memory_service_1 = require("./name-memory.service");
const name_memory_util_1 = require("./name-memory.util");
const scope_1 = require("./scope");
const sub_names_util_1 = require("./sub-names.util");
let SubNamesService = class SubNamesService {
    prisma;
    names;
    accounts;
    constructor(prisma, names, accounts) {
        this.prisma = prisma;
        this.names = names;
        this.accounts = accounts;
    }
    async ensure(scope, parent, category) {
        const nameId = await this.ledgerNameId(scope, parent);
        const found = await this.prisma.subName.findFirst({
            where: { bookId: scope.bookId, nameId, category },
            select: { id: true, name: true },
        });
        if (found)
            return found;
        return this.prisma.subName.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                nameId,
                name: (0, sub_names_util_1.subNameOf)(parent, category),
                category,
            },
            select: { id: true, name: true },
        });
    }
    async list(scope) {
        const subs = await this.prisma.subName.findMany({
            where: { bookId: scope.bookId },
            orderBy: { name: 'asc' },
        });
        if (!subs.length)
            return [];
        const [parents, counts] = await Promise.all([
            this.prisma.ledgerName.findMany({
                where: { id: { in: [...new Set(subs.map((s) => s.nameId))] } },
                select: { id: true, name: true },
            }),
            this.prisma.bankTransaction.groupBy({
                by: ['subNameId'],
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    subNameId: { in: subs.map((s) => s.id) },
                    statement: { deletedAt: null },
                },
                _count: { _all: true },
            }),
        ]);
        const parentOf = new Map(parents.map((p) => [p.id, p.name]));
        const rowsOf = new Map(counts.map((c) => [c.subNameId, c._count._all]));
        return subs.flatMap((s) => {
            const parent = parentOf.get(s.nameId);
            return parent
                ? [
                    {
                        id: s.id,
                        parent,
                        name: s.name,
                        category: s.category,
                        rows: rowsOf.get(s.id) ?? 0,
                    },
                ]
                : [];
        });
    }
    async setCategory(scope, id, rawCategory) {
        const sub = await this.get(scope, id);
        const category = await this.accounts.validCategory(scope, rawCategory);
        const parent = await this.parentName(sub.nameId);
        if (parent && (await this.names.categoryOfName(scope, parent)) === category) {
            await this.remove(scope, id);
            return;
        }
        const other = await this.prisma.subName.findFirst({
            where: { bookId: scope.bookId, nameId: sub.nameId, category, id: { not: id } },
            select: { id: true },
        });
        const target = other?.id ?? id;
        if (!other) {
            await this.prisma.subName.update({
                where: { id },
                data: {
                    category,
                    ...(parent && { name: (0, sub_names_util_1.subNameOf)(parent, category) }),
                },
            });
        }
        await this.moveRows(scope, id, target, category);
        if (other)
            await this.prisma.subName.delete({ where: { id } });
    }
    async remove(scope, id) {
        const sub = await this.get(scope, id);
        const parent = await this.parentName(sub.nameId);
        const category = (parent && (await this.names.categoryOfName(scope, parent))) ??
            sub.category;
        await this.moveRows(scope, id, null, category);
        await this.prisma.subName.delete({ where: { id } });
    }
    async ledgerNameId(scope, name) {
        const clean = (0, name_memory_util_1.cleanName)(name) ?? name;
        const found = await this.prisma.ledgerName.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), name: clean },
            select: { id: true },
        });
        if (found)
            return found.id;
        const made = await this.prisma.ledgerName.create({
            data: { ...(0, scope_1.scopeWhere)(scope), name: clean },
            select: { id: true },
        });
        return made.id;
    }
    async get(scope, id) {
        const sub = await this.prisma.subName.findFirst({
            where: { id, bookId: scope.bookId, customerId: scope.customerId },
        });
        if (!sub)
            throw new common_1.NotFoundException('Sub-name not found');
        return sub;
    }
    async parentName(nameId) {
        const row = await this.prisma.ledgerName.findUnique({
            where: { id: nameId },
            select: { name: true },
        });
        return row?.name ?? null;
    }
    async moveRows(scope, from, to, category) {
        const rows = await this.prisma.bankTransaction.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), subNameId: from },
            select: {
                id: true,
                amount: true,
                debitAccount: true,
                creditAccount: true,
                splitOf: {
                    select: { amount: true, debitAccount: true, creditAccount: true },
                },
            },
        });
        if (!rows.length)
            return;
        await this.prisma.$transaction(rows.map((r) => {
            const of = r.splitOf ?? r;
            const amount = Number(of.amount);
            const bank = amount < 0 ? of.creditAccount : of.debitAccount;
            return this.prisma.bankTransaction.update({
                where: { id: r.id },
                data: {
                    subNameId: to,
                    offsetAccount: category,
                    ...(0, ledger_util_1.doubleEntry)(amount, bank, category),
                },
            });
        }));
    }
};
exports.SubNamesService = SubNamesService;
exports.SubNamesService = SubNamesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        name_memory_service_1.NameMemoryService,
        customer_accounts_service_1.CustomerAccountsService])
], SubNamesService);
//# sourceMappingURL=sub-names.service.js.map