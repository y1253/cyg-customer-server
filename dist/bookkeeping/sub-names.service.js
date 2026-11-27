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
const name_memory_util_1 = require("./name-memory.util");
const reports_util_1 = require("./reports.util");
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
            const [split, named] = await Promise.all([
                this.prisma.bankTransaction.groupBy({
                    by: ['customerId', 'bookId', 'companyId'],
                    where: { splitOfId: { not: null }, splitRuleId: null },
                }),
                this.prisma.subName.groupBy({
                    by: ['customerId', 'bookId', 'companyId'],
                }),
            ]);
            const books = new Map([...split, ...named].map((b) => [b.bookId, b]));
            let changed = 0;
            for (const b of books.values()) {
                await this.adoptParentPicks(b);
                changed += await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, b);
            }
            if (changed) {
                this.logger.log(`filed ${changed} row(s) under their sub-name`);
            }
        }
        catch (err) {
            this.logger.warn(`parent sub-names not synced: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async adoptParentPicks(scope) {
        const subs = await this.prisma.subName.findMany({
            where: { bookId: scope.bookId, ownAgencies: false },
            select: { id: true, nameId: true, name: true },
        });
        for (const s of subs) {
            const hand = await this.prisma.bankTransaction.count({
                where: { bookId: scope.bookId, subNameId: s.id, splitRuleId: null },
            });
            const parent = hand ? await this.parentName(s.nameId) : null;
            if (parent)
                await (0, sub_name_parents_1.copyParentPicks)(this.prisma, scope, parent, s.name);
            await this.prisma.subName.update({
                where: { id: s.id },
                data: { ownAgencies: true },
            });
        }
    }
    async ensure(scope, parent, category) {
        return (0, sub_name_parents_1.ensureSubName)(this.prisma, scope, parent, category);
    }
    async parentOfSubName(scope, id) {
        const sub = await this.prisma.subName.findFirst({
            where: { id, bookId: scope.bookId },
            select: { nameId: true },
        });
        return sub ? this.parentName(sub.nameId) : null;
    }
    async list(scope) {
        const subs = await this.prisma.subName.findMany({
            where: { bookId: scope.bookId },
            orderBy: { name: 'asc' },
        });
        if (!subs.length)
            return [];
        const [parents, counts, ruled] = await Promise.all([
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
            this.prisma.bankTransaction.groupBy({
                by: ['subNameId'],
                where: {
                    bookId: scope.bookId,
                    subNameId: { in: subs.map((s) => s.id) },
                    splitRuleId: { not: null },
                },
            }),
        ]);
        const fromRule = new Set(ruled.map((r) => r.subNameId));
        const parentOf = new Map(parents.map((p) => [p.id, p.name]));
        const rowsOf = new Map(counts.map((c) => [c.subNameId, c._count._all]));
        const picks = await this.prisma.ledgerNameAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), agency: { deletedAt: null } },
            select: { name: true, agencyId: true, alone: true },
            orderBy: { agencyId: 'asc' },
        });
        const picksOf = (name) => picks
            .filter((p) => (0, tax_util_1.nameTaxKey)(p.name) === (0, tax_util_1.nameTaxKey)(name))
            .map((p) => p.agencyId);
        const aloneOf = (name) => picks.some((p) => p.alone && (0, tax_util_1.nameTaxKey)(p.name) === (0, tax_util_1.nameTaxKey)(name));
        const rowTotals = await this.rowTotals(scope, subs.map((s) => s.id));
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
                        total: (rowTotals.get(s.id) ?? 0) / 100,
                        group: s.group,
                        fields: (0, tax_service_1.parseNameFields)(s.fields),
                        renamed: s.renamed,
                        ownAgencies: s.ownAgencies,
                        agencyIds: s.ownAgencies ? picksOf(s.name) : [],
                        agencyAlone: s.ownAgencies && aloneOf(s.name),
                        fromRule: fromRule.has(s.id),
                    },
                ]
                : [];
        });
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
    async setCategory(scope, id, rawCategory) {
        const sub = await this.get(scope, id);
        const category = await this.accounts.validCategory(scope, rawCategory);
        const parent = await this.parentName(sub.nameId);
        const other = await this.prisma.subName.findFirst({
            where: {
                bookId: scope.bookId,
                nameId: sub.nameId,
                category,
                splitKey: sub.splitKey,
                id: { not: id },
            },
            select: { id: true },
        });
        const target = other?.id ?? id;
        if (!other) {
            const name = parent && !sub.renamed
                ? sub.splitKey
                    ? (0, sub_names_util_1.splitSubNameOf)(parent, category, (0, sub_names_util_1.splitLabelOf)(sub.name, parent, sub.category))
                    : (0, sub_names_util_1.subNameOf)(parent, category)
                : sub.name;
            await this.prisma.subName.update({
                where: { id },
                data: { category, name },
            });
            await this.tax.moveSubNameKeys(scope, sub.name, name);
        }
        await this.moveRows(scope, id, target, category);
        if (other) {
            const into = await this.get(scope, other.id);
            await this.prisma.subName.update({
                where: { id: into.id },
                data: {
                    ...(!into.group && sub.group && { group: sub.group }),
                    ...(into.fields == null &&
                        sub.fields != null && {
                        fields: sub.fields,
                    }),
                },
            });
            await this.tax.moveSubNameKeys(scope, sub.name, into.name);
            await this.prisma.subName.delete({ where: { id } });
        }
        await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, scope);
    }
    async setSettings(scope, id, input) {
        const sub = await this.get(scope, id);
        const parent = await this.parentName(sub.nameId);
        let name = sub.name;
        const data = {};
        if (input.name !== undefined) {
            const auto = (0, sub_names_util_1.subNameOf)(parent ?? sub.name, sub.category);
            const typed = input.name.replace(/\s+/g, ' ').trim().slice(0, 191);
            name = typed || auto;
            if ((0, name_memory_util_1.nameKey)(name) !== (0, name_memory_util_1.nameKey)(sub.name))
                await this.refuseTaken(scope, name, id);
            data.name = name;
            data.renamed = (0, name_memory_util_1.nameKey)(name) !== (0, name_memory_util_1.nameKey)(auto);
        }
        if (input.group !== undefined) {
            await this.tax.checkGroup(scope, input.group);
            data.group = input.group;
        }
        if (input.fields !== undefined)
            data.fields = (0, tax_service_1.cleanNameFields)(input.fields);
        if (input.agencyIds !== undefined)
            data.ownAgencies = input.agencyIds !== null;
        await this.prisma.subName.update({ where: { id }, data });
        if (name !== sub.name)
            await this.tax.moveSubNameKeys(scope, sub.name, name);
        if (input.agencyIds !== undefined)
            await this.tax.writePicks(scope, name, input.agencyIds ?? [], input.alone === true);
    }
    async refuseTaken(scope, name, id) {
        const [asName, asSub] = await Promise.all([
            this.prisma.ledgerName.findFirst({
                where: { ...(0, scope_1.scopeWhere)(scope), name },
                select: { id: true },
            }),
            this.prisma.subName.findFirst({
                where: { bookId: scope.bookId, name, id: { not: id } },
                select: { id: true },
            }),
        ]);
        const used = asName ||
            asSub ||
            (await this.prisma.bankTransaction.findFirst({
                where: { ...(0, scope_1.scopeWhere)(scope), name },
                select: { id: true },
            }));
        if (used)
            throw new common_1.BadRequestException(`“${name}” is already a name — pick another`);
    }
    async remove(scope, id) {
        const sub = await this.get(scope, id);
        const parent = await this.parentName(sub.nameId);
        const others = await this.prisma.subName.count({
            where: { bookId: scope.bookId, nameId: sub.nameId, id: { not: id } },
        });
        if (others)
            throw new common_1.BadRequestException('Change its category to join another sub-name — every row of the name stays under one');
        const split = parent
            ? await this.prisma.bankTransaction.count({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    name: parent,
                    splitOfId: null,
                    splits: { some: { splitRuleId: null } },
                },
            })
            : 0;
        if (split)
            throw new common_1.BadRequestException(`“${parent}” has split transactions — they keep it under sub-names`);
        const category = (parent && (await this.names.categoryOfName(scope, parent))) ??
            sub.category;
        await this.moveRows(scope, id, null, category);
        await (0, sub_name_parents_1.deleteSubName)(this.prisma, id);
        await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, scope);
    }
    async merge(scope, input) {
        const fromSub = input.fromSubNameId ?? null;
        const intoSub = input.intoSubNameId ?? null;
        if ((input.from == null) === (fromSub == null) ||
            (input.into == null) === (intoSub == null))
            throw new common_1.BadRequestException('Pick one name or sub-name, and the one to merge it into');
        if (fromSub == null && (await this.names.isWrapper(scope, input.from)))
            return this.mergeWrapper(scope, input.from, {
                name: input.into,
                subNameId: intoSub ?? undefined,
            });
        if (fromSub == null && intoSub == null)
            return this.names.mergeNames(scope, input.from, input.into);
        if (fromSub == null)
            return this.names.mergeIntoSubName(scope, input.from, intoSub);
        return this.names.mergeSubName(scope, fromSub, {
            name: input.into,
            subNameId: intoSub ?? undefined,
        });
    }
    async mergeWrapper(scope, rawFrom, into) {
        const from = (0, name_memory_util_1.cleanName)(rawFrom);
        if (!from)
            throw new common_1.BadRequestException('Pick two names.');
        const fromId = await (0, sub_name_parents_1.ledgerNameId)(this.prisma, scope, from);
        const subs = await this.prisma.subName.findMany({
            where: { bookId: scope.bookId, nameId: fromId },
            orderBy: { id: 'asc' },
        });
        if (into.subNameId != null) {
            const target = await this.get(scope, into.subNameId);
            if (subs.some((s) => s.id === target.id))
                throw new common_1.BadRequestException(`It is already under “${from}” — drop it on another name.`);
            for (const sub of subs)
                await this.names.mergeSubName(scope, sub.id, {
                    subNameId: target.id,
                });
            return this.names.mergeIntoSubName(scope, from, target.id);
        }
        const target = (0, name_memory_util_1.cleanName)(into.name);
        if (!target)
            throw new common_1.BadRequestException('Pick a name to merge it into.');
        if ((0, name_memory_util_1.nameKey)(target) === (0, name_memory_util_1.nameKey)(from))
            throw new common_1.BadRequestException('That is the same name.');
        if ((0, name_memory_util_1.nameKey)(target) === (0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME))
            throw new common_1.BadRequestException('"Unclarified name" cannot be merged — give its rows a name instead.');
        if (await this.prisma.subName.findFirst({
            where: { bookId: scope.bookId, name: target },
            select: { id: true },
        }))
            throw new common_1.BadRequestException(`"${target}" is a sub-name — drop it on a name instead.`);
        const agencies = await this.prisma.taxAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            select: { name: true },
        });
        if (agencies.some((a) => (0, name_memory_util_1.nameKey)(a.name) === (0, name_memory_util_1.nameKey)(target)))
            throw new common_1.BadRequestException(`"${target}" is a split rule — split rules cannot be merged.`);
        const targetId = await (0, sub_name_parents_1.ledgerNameId)(this.prisma, scope, target);
        for (const sub of subs) {
            const same = await this.prisma.subName.findFirst({
                where: {
                    bookId: scope.bookId,
                    nameId: targetId,
                    category: sub.category,
                    splitKey: sub.splitKey,
                },
                select: { id: true },
            });
            if (same)
                await this.names.mergeSubName(scope, sub.id, { subNameId: same.id });
            else
                await this.setParent(scope, sub.id, target);
        }
        await this.names.mergeNames(scope, from, target);
    }
    async setParent(scope, id, rawParent) {
        const sub = await this.get(scope, id);
        const oldParent = await this.parentName(sub.nameId);
        const parent = (0, name_memory_util_1.cleanName)(rawParent);
        if (!parent)
            throw new common_1.BadRequestException('Pick a name to move it under.');
        if ((0, name_memory_util_1.nameKey)(parent) === (0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME))
            throw new common_1.BadRequestException('"Unclarified name" cannot have sub-names — give its rows a name instead.');
        if (oldParent && (0, name_memory_util_1.nameKey)(parent) === (0, name_memory_util_1.nameKey)(oldParent))
            throw new common_1.BadRequestException(`It is already under “${oldParent}”.`);
        if ((0, name_memory_util_1.nameKey)(parent) === (0, name_memory_util_1.nameKey)(sub.name))
            throw new common_1.BadRequestException('A sub-name cannot go under itself.');
        const agencies = await this.prisma.taxAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            select: { name: true },
        });
        if (agencies.some((a) => (0, name_memory_util_1.nameKey)(a.name) === (0, name_memory_util_1.nameKey)(parent)))
            throw new common_1.BadRequestException(`"${parent}" is a split rule — it cannot have sub-names.`);
        if (await this.prisma.subName.findFirst({
            where: { bookId: scope.bookId, name: parent },
            select: { id: true },
        }))
            throw new common_1.BadRequestException(`"${parent}" is a sub-name — drop it on a name instead.`);
        const nameId = await (0, sub_name_parents_1.ledgerNameId)(this.prisma, scope, parent);
        const clash = await this.prisma.subName.findFirst({
            where: {
                bookId: scope.bookId,
                nameId,
                category: sub.category,
                splitKey: sub.splitKey,
                id: { not: id },
            },
            select: { id: true },
        });
        const splitKey = clash ? `m${id}` : sub.splitKey;
        const name = sub.renamed
            ? sub.name
            : clash
                ? (0, sub_names_util_1.splitSubNameOf)(parent, sub.category, oldParent ?? sub.name)
                : sub.splitKey
                    ? (0, sub_names_util_1.splitSubNameOf)(parent, sub.category, (0, sub_names_util_1.splitLabelOf)(sub.name, oldParent ?? '', sub.category))
                    : (0, sub_names_util_1.subNameOf)(parent, sub.category);
        if ((0, name_memory_util_1.nameKey)(name) !== (0, name_memory_util_1.nameKey)(sub.name))
            await this.refuseTaken(scope, name, id);
        await this.prisma.subName.update({
            where: { id },
            data: { nameId, name, splitKey },
        });
        if (name !== sub.name)
            await this.tax.moveSubNameKeys(scope, sub.name, name);
        await this.names.reparentSubNameRows(scope, id, parent);
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
        await this.prisma.customerNameRule.updateMany({
            where: { ...(0, scope_1.scopeWhere)(scope), subNameId: from },
            data: to === null
                ? { subNameId: null, category: null }
                : { subNameId: to, category },
        });
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