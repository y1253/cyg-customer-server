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
var SubNamesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubNamesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const customer_accounts_service_1 = require("./customer-accounts.service");
const ledger_util_1 = require("./ledger.util");
const name_memory_service_1 = require("./name-memory.service");
const scope_1 = require("./scope");
const splits_util_1 = require("./splits.util");
const sub_names_util_1 = require("./sub-names.util");
const sub_name_parents_1 = require("./sub-name-parents");
const tax_service_1 = require("./tax.service");
const tax_util_1 = require("./tax.util");
let SubNamesService = SubNamesService_1 = class SubNamesService {
    prisma;
    names;
    accounts;
    tax;
    logger = new common_1.Logger(SubNamesService_1.name);
    constructor(prisma, names, accounts, tax) {
        this.prisma = prisma;
        this.names = names;
        this.accounts = accounts;
        this.tax = tax;
    }
    onApplicationBootstrap() {
        setTimeout(() => void this.backfillParents(), 70_000).unref();
    }
    async backfillParents() {
        try {
            const books = await this.prisma.bankTransaction.groupBy({
                by: ['customerId', 'bookId', 'companyId'],
                where: { splitOfId: { not: null }, subNameId: { not: null } },
            });
            let changed = 0;
            for (const b of books)
                changed += await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, b);
            if (changed) {
                this.logger.log(`gave ${changed} split transaction(s) their own sub-name`);
            }
        }
        catch (err) {
            this.logger.warn(`parent sub-names not synced: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async ensure(scope, parent, category) {
        return (0, sub_name_parents_1.ensureSubName)(this.prisma, scope, parent, category);
    }
    async list(scope) {
        await (0, sub_name_parents_1.syncTaxSubNames)(this.prisma, scope).catch((err) => this.logger.warn(`tax sub-names not synced: ${err instanceof Error ? err.message : String(err)}`));
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
        const agencies = await this.agencyNames(scope);
        const [rowTotals, taxTotals] = await Promise.all([
            this.rowTotals(scope, subs.map((s) => s.id)),
            this.taxTotals(scope, subs.filter((s) => agencies.has(s.category)), parentOf),
        ]);
        return subs.flatMap((s) => {
            const parent = parentOf.get(s.nameId);
            const tax = agencies.has(s.category);
            const total = tax
                ? (taxTotals.get(s.id) ?? { cents: 0, rows: 0 })
                : { cents: rowTotals.get(s.id) ?? 0, rows: rowsOf.get(s.id) ?? 0 };
            return parent && !(tax && !total.rows)
                ? [
                    {
                        id: s.id,
                        parent,
                        name: s.name,
                        category: s.category,
                        rows: total.rows,
                        total: total.cents / 100,
                        ...(tax && { tax: true }),
                    },
                ]
                : [];
        });
    }
    async agencyNames(scope) {
        const rows = await this.prisma.taxAgency.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { name: true },
        });
        return new Set(rows.map((r) => r.name));
    }
    async rowTotals(scope, ids) {
        const out = new Map();
        if (!ids.length)
            return out;
        const read = { deletedAt: null, status: client_1.StatementStatus.DONE };
        const rows = await this.prisma.bankTransaction.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), subNameId: { in: ids }, statement: read },
            select: { id: true, amount: true, splitOfId: true, subNameId: true },
        });
        const parentIds = rows.filter((r) => r.splitOfId === null).map((r) => r.id);
        const splits = parentIds.length
            ? await this.prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), splitOfId: { in: parentIds } },
                select: { amount: true, splitOfId: true },
            })
            : [];
        const totals = (0, splits_util_1.splitTotals)(splits.map((r) => ({ splitOfId: r.splitOfId, amount: Number(r.amount) })));
        for (const r of rows) {
            const cents = Math.round((0, splits_util_1.remainderOf)({ ...r, amount: Number(r.amount) }, totals) * 100);
            out.set(r.subNameId, (out.get(r.subNameId) ?? 0) + cents);
        }
        return out;
    }
    async taxTotals(scope, subs, parentOf) {
        const out = new Map();
        if (!subs.length)
            return out;
        const lines = await this.tax.linesFor(scope);
        if (!lines.size)
            return out;
        const rows = await this.prisma.bankTransaction.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), id: { in: [...lines.keys()] } },
            select: { id: true, name: true, amount: true },
        });
        const subOf = new Map(subs.flatMap((s) => {
            const parent = parentOf.get(s.nameId);
            return parent
                ? [[`${(0, tax_util_1.nameTaxKey)(parent)}|${s.category}`, s.id]]
                : [];
        }));
        for (const r of rows) {
            const sign = Number(r.amount) < 0 ? -1 : 1;
            for (const l of lines.get(r.id) ?? []) {
                const id = subOf.get(`${(0, tax_util_1.nameTaxKey)(r.name)}|${l.agency}`);
                if (id === undefined)
                    continue;
                const t = out.get(id) ?? { cents: 0, rows: 0 };
                t.cents += sign * Math.round(l.amount * 100);
                t.rows++;
                out.set(id, t);
            }
        }
        return out;
    }
    async refuseTax(scope, sub) {
        if ((await this.agencyNames(scope)).has(sub.category)) {
            throw new common_1.BadRequestException("This sub-name holds a tax line — it follows the name's tax agency. Change the name's agencies instead.");
        }
    }
    async setCategory(scope, id, rawCategory) {
        const sub = await this.get(scope, id);
        await this.refuseTax(scope, sub);
        const category = await this.accounts.validCategory(scope, rawCategory);
        const parent = await this.parentName(sub.nameId);
        if (parent &&
            (await this.names.categoryOfName(scope, parent)) === category) {
            await this.remove(scope, id);
            return;
        }
        const other = await this.prisma.subName.findFirst({
            where: {
                bookId: scope.bookId,
                nameId: sub.nameId,
                category,
                id: { not: id },
            },
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
        await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, scope);
    }
    async remove(scope, id) {
        const sub = await this.get(scope, id);
        await this.refuseTax(scope, sub);
        const parent = await this.parentName(sub.nameId);
        const category = (parent && (await this.names.categoryOfName(scope, parent))) ??
            sub.category;
        await this.moveRows(scope, id, null, category);
        await this.prisma.subName.delete({ where: { id } });
        await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, scope);
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
exports.SubNamesService = SubNamesService = SubNamesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        name_memory_service_1.NameMemoryService,
        customer_accounts_service_1.CustomerAccountsService,
        tax_service_1.TaxService])
], SubNamesService);
//# sourceMappingURL=sub-names.service.js.map