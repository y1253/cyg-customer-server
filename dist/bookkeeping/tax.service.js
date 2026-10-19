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
exports.TaxService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const chart_of_accounts_1 = require("./chart-of-accounts");
const customer_accounts_service_1 = require("./customer-accounts.service");
const name_memory_util_1 = require("./name-memory.util");
const reports_util_1 = require("./reports.util");
const scope_1 = require("./scope");
const splits_util_1 = require("./splits.util");
const tax_util_1 = require("./tax.util");
const KIND_ORDER = ['SALES', 'PURCHASE'];
const toAgency = (a) => ({
    id: a.id,
    name: a.name,
    rates: KIND_ORDER.flatMap((kind) => {
        const r = a.rates.find((x) => x.kind === kind);
        return r ? [{ kind, rate: Number(r.rate) }] : [];
    }),
    active: a.active,
});
function rateRows(rates) {
    if (new Set(rates.map((r) => r.kind)).size !== rates.length) {
        throw new common_1.BadRequestException('Give each kind of tax only one rate');
    }
    return rates.map((r) => ({ kind: r.kind, rate: r.rate.toFixed(3) }));
}
const typeOfCategory = (category, ctx) => {
    const type = (0, chart_of_accounts_1.typeFor)(category, ctx);
    if (type === 'INCOME')
        return 'CUSTOMER';
    if (type === 'EXPENSE')
        return 'SUPPLIER';
    return 'OTHER';
};
const DONE = { deletedAt: null, status: client_1.StatementStatus.DONE };
let TaxService = class TaxService {
    prisma;
    accounts;
    constructor(prisma, accounts) {
        this.prisma = prisma;
        this.accounts = accounts;
    }
    async settings(scope) {
        const agencies = await this.prisma.taxAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            include: { rates: true },
            orderBy: { createdAt: 'asc' },
        });
        return { agencies: agencies.map(toAgency) };
    }
    async createAgency(scope, dto) {
        const name = await this.checkName(scope, dto.name);
        const row = await this.prisma.taxAgency.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                name,
                active: dto.active ?? true,
                rates: { create: rateRows(dto.rates) },
            },
            include: { rates: true },
        });
        return toAgency(row);
    }
    async updateAgency(scope, id, dto) {
        await this.ownedAgency(scope, id);
        const name = dto.name === undefined
            ? undefined
            : await this.checkName(scope, dto.name, id);
        const rates = dto.rates && rateRows(dto.rates);
        const row = await this.prisma.taxAgency.update({
            where: { id },
            data: {
                name,
                active: dto.active,
                ...(rates && { rates: { deleteMany: {}, create: rates } }),
            },
            include: { rates: true },
        });
        return toAgency(row);
    }
    async removeAgency(scope, id) {
        await this.ownedAgency(scope, id);
        await this.prisma.$transaction([
            this.prisma.taxAgency.update({
                where: { id },
                data: { deletedAt: new Date(), active: false },
            }),
            this.prisma.ledgerNameAgency.deleteMany({
                where: { ...(0, scope_1.scopeWhere)(scope), agencyId: id },
            }),
        ]);
    }
    async ownedAgency(scope, id) {
        const a = await this.prisma.taxAgency.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
        });
        if (!a)
            throw new common_1.NotFoundException('Agency not found');
        return a;
    }
    async checkName(scope, raw, exceptId) {
        const name = raw.trim();
        if (!name)
            throw new common_1.BadRequestException('Give the agency a name');
        const lower = name.toLowerCase();
        if (chart_of_accounts_1.ACCOUNT_NAMES.some((n) => n.toLowerCase() === lower)) {
            throw new common_1.BadRequestException(`"${name}" is already an account name — choose another`);
        }
        const others = await this.prisma.taxAgency.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                deletedAt: null,
                NOT: { id: exceptId ?? 0 },
            },
            select: { name: true },
        });
        if (others.some((o) => o.name.toLowerCase() === lower)) {
            throw new common_1.BadRequestException(`You already have an agency "${name}"`);
        }
        return name;
    }
    async agencyNames(scope) {
        const rows = await this.prisma.taxAgency.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { name: true },
        });
        return rows.map((r) => r.name);
    }
    async typeContext(scope) {
        const [overrides, custom, agencies] = await Promise.all([
            this.accounts.overrides(scope),
            this.accounts.types(scope),
            this.agencyNames(scope),
        ]);
        return { overrides, custom, liabilities: new Set(agencies) };
    }
    linesFor(scope, statementIds) {
        return this.compute(scope, {
            ...(statementIds?.length && { statementId: { in: statementIds } }),
        });
    }
    async compute(scope, where) {
        const out = new Map();
        const picks = await this.prisma.ledgerNameAgency.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { name: true, agencyId: true },
        });
        if (!picks.length)
            return out;
        const [agencyRows, rows, named, ctx] = await Promise.all([
            this.prisma.taxAgency.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null, active: true },
                include: { rates: true },
                orderBy: { createdAt: 'asc' },
            }),
            this.prisma.bankTransaction.findMany({
                where: { ...where, ...(0, scope_1.scopeWhere)(scope), statement: DONE },
                select: {
                    id: true,
                    name: true,
                    offsetAccount: true,
                    amount: true,
                    splitOfId: true,
                },
            }),
            this.prisma.transactionTax.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), name: { not: null } },
                select: { transactionId: true, agencyId: true, name: true },
            }),
            this.typeContext(scope),
        ]);
        const agencies = agencyRows.map((a) => ({
            id: a.id,
            name: a.name,
            rates: Object.fromEntries(a.rates.map((r) => [r.kind, Number(r.rate)])),
        }));
        const agenciesOf = new Map();
        for (const p of picks) {
            const key = (0, tax_util_1.nameTaxKey)(p.name);
            agenciesOf.set(key, [...(agenciesOf.get(key) ?? []), p.agencyId]);
        }
        const totals = (0, splits_util_1.splitTotals)(rows.map((r) => ({ splitOfId: r.splitOfId, amount: Number(r.amount) })));
        const sized = rows.map((r) => ({
            id: r.id,
            name: r.name,
            offsetAccount: r.offsetAccount,
            amount: (0, splits_util_1.remainderOf)({ ...r, amount: Number(r.amount) }, totals),
        }));
        const amountOf = new Map(sized.map((r) => [r.id, r.amount]));
        const nameOf = new Map(named.map((n) => [`${n.transactionId}:${n.agencyId}`, n.name]));
        for (const [id, lines] of (0, tax_util_1.nameTaxLines)(sized, agenciesOf, agencies, ctx)) {
            out.set(id, lines.map((l) => ({
                ...l,
                name: nameOf.get(`${id}:${l.agencyId}`) ?? null,
                amount: (0, tax_util_1.taxAmount)(amountOf.get(id) ?? 0, l.rate),
            })));
        }
        return out;
    }
    async names(scope) {
        const [groups, named, nameless, picks, rules, ctx] = await Promise.all([
            this.prisma.bankTransaction.groupBy({
                by: ['name', 'offsetAccount'],
                where: { ...(0, scope_1.scopeWhere)(scope), name: { not: null }, statement: DONE },
                _count: { _all: true },
            }),
            this.prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), name: { not: null }, statement: DONE },
                select: { name: true, description: true, offsetAccount: true },
            }),
            this.prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), name: null, statement: DONE },
                select: { description: true, offsetAccount: true },
            }),
            this.prisma.ledgerNameAgency.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), agency: { deletedAt: null } },
                select: { name: true, agencyId: true },
                orderBy: { agencyId: 'asc' },
            }),
            this.prisma.customerNameRule.findMany({
                where: (0, scope_1.scopeWhere)(scope),
                select: { matchType: true, matchKey: true, name: true },
            }),
            this.typeContext(scope),
        ]);
        const descriptionsOf = groupDescriptions(named);
        const agenciesOf = new Map();
        for (const p of picks) {
            const key = (0, tax_util_1.nameTaxKey)(p.name);
            agenciesOf.set(key, [...(agenciesOf.get(key) ?? []), p.agencyId]);
        }
        const ref = (r) => ({
            matchType: (r.matchType === 'DESCRIPTION'
                ? 'DESCRIPTION'
                : 'NAME'),
            matchKey: r.matchKey,
        });
        const ruleForName = (key) => {
            const byName = rules.find((r) => r.matchType === 'NAME' &&
                (r.matchKey === key || (r.name && (0, name_memory_util_1.nameKey)(r.name) === key)));
            if (byName)
                return ref(byName);
            const byDesc = rules.find((r) => r.matchType === 'DESCRIPTION' && r.name && (0, name_memory_util_1.nameKey)(r.name) === key);
            return byDesc ? ref(byDesc) : null;
        };
        const byName = new Map();
        for (const g of groups) {
            if (!g.name)
                continue;
            const key = g.name.toLowerCase();
            const entry = byName.get(key) ?? { name: g.name, categories: [] };
            entry.categories.push([g.offsetAccount, g._count._all]);
            byName.set(key, entry);
        }
        const names = [...byName.entries()]
            .map(([key, { name, categories }]) => {
            categories.sort((a, b) => b[1] - a[1]);
            const category = categories[0][0];
            const rule = ruleForName(key);
            return {
                name,
                category,
                otherCategories: categories.length - 1,
                type: typeOfCategory(category, ctx),
                rows: categories.reduce((n, [, c]) => n + c, 0),
                agencyIds: agenciesOf.get((0, tax_util_1.nameTaxKey)(name)) ?? [],
                descriptions: descriptionsOf.get(key) ?? [],
                ruleKey: rule?.matchType === 'NAME' ? rule.matchKey : key,
                rule,
            };
        })
            .sort((a, b) => a.name.localeCompare(b.name));
        const byKey = new Map();
        for (const t of nameless) {
            const key = (0, name_memory_util_1.descriptionKey)(t.description);
            if (!key)
                continue;
            const entry = byKey.get(key) ?? {
                sample: t.description,
                categories: new Map(),
            };
            entry.categories.set(t.offsetAccount, (entry.categories.get(t.offsetAccount) ?? 0) + 1);
            byKey.set(key, entry);
        }
        const unrecognized = [...byKey.entries()]
            .map(([key, { sample, categories }]) => {
            const sorted = [...categories.entries()].sort((a, b) => b[1] - a[1]);
            const descRule = rules.find((r) => r.matchType === 'DESCRIPTION' && r.matchKey === key);
            return {
                key,
                sampleDescription: sample,
                category: sorted[0][0],
                otherCategories: sorted.length - 1,
                rows: sorted.reduce((n, [, c]) => n + c, 0),
                rule: descRule ? ref(descRule) : null,
            };
        })
            .sort((a, b) => b.rows - a.rows || a.key.localeCompare(b.key));
        if (nameless.length) {
            names.push({
                name: reports_util_1.UNCLARIFIED_NAME,
                category: chart_of_accounts_1.UNCATEGORIZED,
                otherCategories: 0,
                type: 'OTHER',
                rows: nameless.length,
                agencyIds: agenciesOf.get((0, tax_util_1.nameTaxKey)(null)) ?? [],
                descriptions: unrecognized.slice(0, MAX_DESCRIPTIONS).map((u) => ({
                    description: u.sampleDescription,
                    category: u.category,
                    rows: u.rows,
                })),
                ruleKey: '',
                rule: null,
                unclarified: true,
            });
            names.sort((a, b) => a.name.localeCompare(b.name));
        }
        return { names, unrecognized };
    }
    async setNameAgencies(scope, name, agencyIds) {
        const clean = name.trim();
        if (!clean)
            throw new common_1.BadRequestException('Which name?');
        const ids = [...new Set(agencyIds)];
        if (ids.length) {
            const owned = await this.prisma.taxAgency.count({
                where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null, id: { in: ids } },
            });
            if (owned !== ids.length)
                throw new common_1.NotFoundException('Agency not found');
        }
        const key = (0, tax_util_1.nameTaxKey)(clean);
        const existing = await this.prisma.ledgerNameAgency.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { id: true, name: true },
        });
        await this.prisma.$transaction([
            this.prisma.ledgerNameAgency.deleteMany({
                where: {
                    id: {
                        in: existing
                            .filter((e) => (0, tax_util_1.nameTaxKey)(e.name) === key)
                            .map((e) => e.id),
                    },
                },
            }),
            this.prisma.ledgerNameAgency.createMany({
                data: ids.map((agencyId) => ({
                    ...(0, scope_1.scopeWhere)(scope),
                    name: clean,
                    agencyId,
                })),
            }),
        ]);
        return this.names(scope);
    }
    async carryAgencies(scope, oldNames, newName) {
        const keys = new Set(oldNames.map(tax_util_1.nameTaxKey));
        if (!keys.size)
            return;
        const rows = await this.prisma.ledgerNameAgency.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { name: true, agencyId: true },
        });
        const target = (0, tax_util_1.nameTaxKey)(newName);
        const have = new Set(rows.filter((r) => (0, tax_util_1.nameTaxKey)(r.name) === target).map((r) => r.agencyId));
        const add = [
            ...new Set(rows
                .filter((r) => keys.has((0, tax_util_1.nameTaxKey)(r.name)) && !have.has(r.agencyId))
                .map((r) => r.agencyId)),
        ];
        if (!add.length)
            return;
        await this.prisma.ledgerNameAgency.createMany({
            data: add.map((agencyId) => ({
                ...(0, scope_1.scopeWhere)(scope),
                name: newName,
                agencyId,
            })),
            skipDuplicates: true,
        });
    }
    async renameLine(scope, transactionId, agencyId, name) {
        const lines = await this.compute(scope, {
            OR: [{ id: transactionId }, { splitOfId: transactionId }],
        });
        const line = lines.get(transactionId)?.find((l) => l.agencyId === agencyId);
        if (!line)
            return false;
        await this.prisma.transactionTax.upsert({
            where: { transactionId_agencyId: { transactionId, agencyId } },
            create: {
                ...(0, scope_1.scopeWhere)(scope),
                transactionId,
                agencyId,
                kind: line.kind,
                rate: line.rate.toFixed(3),
                amount: line.amount.toFixed(2),
                name,
            },
            update: { name },
        });
        return true;
    }
};
exports.TaxService = TaxService;
exports.TaxService = TaxService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        customer_accounts_service_1.CustomerAccountsService])
], TaxService);
const MAX_DESCRIPTIONS = 25;
function groupDescriptions(rows) {
    const byName = new Map();
    for (const r of rows) {
        if (!r.name)
            continue;
        const name = r.name.toLowerCase();
        const key = (0, name_memory_util_1.descriptionKey)(r.description) || r.description.trim().toLowerCase();
        const groups = byName.get(name) ??
            new Map();
        const g = groups.get(key) ?? {
            description: r.description,
            categories: new Map(),
        };
        g.categories.set(r.offsetAccount, (g.categories.get(r.offsetAccount) ?? 0) + 1);
        groups.set(key, g);
        byName.set(name, groups);
    }
    const out = new Map();
    for (const [name, groups] of byName) {
        out.set(name, [...groups.values()]
            .map((g) => {
            const sorted = [...g.categories.entries()].sort((a, b) => b[1] - a[1]);
            return {
                description: g.description,
                category: sorted[0][0],
                rows: sorted.reduce((n, [, c]) => n + c, 0),
            };
        })
            .sort((a, b) => b.rows - a.rows || a.description.localeCompare(b.description))
            .slice(0, MAX_DESCRIPTIONS));
    }
    return out;
}
//# sourceMappingURL=tax.service.js.map