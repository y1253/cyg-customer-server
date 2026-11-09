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
exports.TaxService = exports.BUILTIN_GROUPS = void 0;
exports.parseNameFields = parseNameFields;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const phone_number_util_1 = require("../customer-auth/phone-number.util");
const prisma_service_1 = require("../prisma/prisma.service");
const chart_of_accounts_1 = require("./chart-of-accounts");
const customer_accounts_service_1 = require("./customer-accounts.service");
const name_memory_util_1 = require("./name-memory.util");
const reports_util_1 = require("./reports.util");
const scope_1 = require("./scope");
const splits_util_1 = require("./splits.util");
const agency_dto_1 = require("./dto/agency.dto");
const tax_util_1 = require("./tax.util");
function parseNameFields(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.flatMap((f) => {
        const o = f;
        if (!o || typeof o.value !== 'string' || !o.value)
            return [];
        const kind = agency_dto_1.NAME_FIELD_KINDS.includes(o.kind ?? '')
            ? o.kind
            : 'TEXT';
        return [{ kind, label: typeof o.label === 'string' ? o.label : '', value: o.value }];
    });
}
exports.BUILTIN_GROUPS = [
    { key: 'SUPPLIER', label: 'Suppliers' },
    { key: 'CUSTOMER', label: 'Customers' },
    { key: 'OTHER', label: 'Other' },
];
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
                select: {
                    ...TOTAL_SELECT,
                    ...PROVENANCE_SELECT,
                    name: true,
                    description: true,
                    offsetAccount: true,
                },
            }),
            this.prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), name: null, statement: DONE },
                select: {
                    ...TOTAL_SELECT,
                    ...PROVENANCE_SELECT,
                    description: true,
                    offsetAccount: true,
                },
            }),
            this.prisma.ledgerNameAgency.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), agency: { deletedAt: null } },
                select: { name: true, agencyId: true },
                orderBy: { agencyId: 'asc' },
            }),
            this.prisma.customerNameRule.findMany({
                where: (0, scope_1.scopeWhere)(scope),
                select: {
                    id: true,
                    matchType: true,
                    matchKey: true,
                    name: true,
                    category: true,
                    includeChars: true,
                },
                orderBy: { createdAt: 'asc' },
            }),
            this.typeContext(scope),
        ]);
        const [placed, ownGroups] = await Promise.all([
            this.prisma.ledgerName.findMany({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    OR: [{ group: { not: null } }, { fields: { not: client_1.Prisma.DbNull } }],
                },
                select: { name: true, group: true, fields: true },
            }),
            this.prisma.customerNameGroup.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                select: { id: true, name: true },
            }),
        ]);
        const groupList = [
            ...exports.BUILTIN_GROUPS,
            ...ownGroups.map((g) => ({ key: `g${g.id}`, label: g.name, id: g.id })),
        ];
        const validGroups = new Set(groupList.map((g) => g.key));
        const groupOf = new Map(placed
            .filter((l) => l.group && validGroups.has(l.group))
            .map((l) => [(0, name_memory_util_1.nameKey)(l.name), l.group]));
        const fieldsOf = new Map(placed.map((l) => [(0, name_memory_util_1.nameKey)(l.name), parseNameFields(l.fields)]));
        const rulesById = new Map(rules.map((r) => [r.id, r]));
        const { descriptionsOf, exceptionOf } = groupDescriptions([...named, ...nameless], rulesById);
        const shareOf = rowShares([...named, ...nameless]);
        const totalOf = new Map();
        for (const r of named) {
            const key = r.name.toLowerCase();
            totalOf.set(key, (totalOf.get(key) ?? 0) + shareOf(r));
        }
        const agenciesOf = new Map();
        for (const p of picks) {
            const key = (0, tax_util_1.nameTaxKey)(p.name);
            agenciesOf.set(key, [...(agenciesOf.get(key) ?? []), p.agencyId]);
        }
        const ref = (r) => ({
            matchType: (r.matchType === 'DESCRIPTION' || r.matchType === 'CONTAINS'
                ? r.matchType
                : 'NAME'),
            matchKey: r.matchKey,
        });
        const ruleForName = (key) => {
            const byName = rules.find((r) => r.matchType === 'NAME' &&
                (r.matchKey === key || (r.name && (0, name_memory_util_1.nameKey)(r.name) === key)));
            if (byName)
                return ref(byName);
            const byDesc = rules.find((r) => (r.matchType === 'DESCRIPTION' || r.matchType === 'CONTAINS') &&
                r.name &&
                (0, name_memory_util_1.nameKey)(r.name) === key);
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
                total: (totalOf.get(key) ?? 0) / 100,
                agencyIds: agenciesOf.get((0, tax_util_1.nameTaxKey)(name)) ?? [],
                fields: fieldsOf.get(key) ?? [],
                descriptions: descriptionsOf.get(key) ?? [],
                followsContains: rules
                    .filter((r) => r.matchType === 'CONTAINS' && r.name && (0, name_memory_util_1.nameKey)(r.name) === key)
                    .map((r) => ({
                    key: r.matchKey,
                    text: r.includeChars ?? r.matchKey,
                    category: r.category,
                    rows: [...named, ...nameless].filter((t) => !t.splitOfId &&
                        (0, name_memory_util_1.descriptionContains)(t.description, r.matchKey)).length,
                })),
                exceptionOf: exceptionOf.get(key) ?? [],
                group: groupOf.get(key) ?? typeOfCategory(category, ctx),
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
                cents: 0,
            };
            entry.cents += shareOf(t);
            entry.categories.set(t.offsetAccount, (entry.categories.get(t.offsetAccount) ?? 0) + 1);
            byKey.set(key, entry);
        }
        const unrecognized = [...byKey.entries()]
            .map(([key, { sample, categories, cents }]) => {
            const sorted = [...categories.entries()].sort((a, b) => b[1] - a[1]);
            const descRule = rules.find((r) => r.matchType === 'DESCRIPTION' && r.matchKey === key);
            return {
                key,
                sampleDescription: sample,
                category: sorted[0][0],
                otherCategories: sorted.length - 1,
                rows: sorted.reduce((n, [, c]) => n + c, 0),
                total: cents / 100,
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
                total: nameless.reduce((n, r) => n + shareOf(r), 0) / 100,
                agencyIds: agenciesOf.get((0, tax_util_1.nameTaxKey)(null)) ?? [],
                fields: [],
                descriptions: unrecognized.slice(0, MAX_DESCRIPTIONS).map((u) => ({
                    key: u.key,
                    description: u.sampleDescription,
                    category: u.category,
                    rows: u.rows,
                    rule: null,
                    exceptions: descriptionsOf
                        .get((0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME))
                        ?.find((d) => d.key === u.key)?.exceptions ?? [],
                })),
                followsContains: [],
                exceptionOf: exceptionOf.get((0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME)) ?? [],
                group: 'OTHER',
                ruleKey: '',
                rule: null,
                unclarified: true,
            });
            names.sort((a, b) => a.name.localeCompare(b.name));
        }
        const descriptions = [...named, ...nameless].filter((r) => !r.splitOfId);
        const containsRules = rules
            .filter((r) => r.matchType === 'CONTAINS' && !r.name)
            .map((r) => ({
            text: r.includeChars ?? r.matchKey,
            key: r.matchKey,
            name: r.name,
            category: r.category,
            rows: descriptions.filter((t) => (0, name_memory_util_1.descriptionContains)(t.description, r.matchKey)).length,
        }));
        return { names, unrecognized, containsRules, groups: groupList };
    }
    async setNameGroup(scope, rawName, group) {
        const name = rawName.trim();
        if (!name || (0, name_memory_util_1.nameKey)(name) === (0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME))
            throw new common_1.BadRequestException('Pick a name');
        if (group && /^g\d+$/.test(group)) {
            const own = await this.prisma.customerNameGroup.findFirst({
                where: {
                    id: Number(group.slice(1)),
                    ...(0, scope_1.scopeWhere)(scope),
                    deletedAt: null,
                },
                select: { id: true },
            });
            if (!own)
                throw new common_1.BadRequestException('That group no longer exists');
        }
        const existing = await this.prisma.ledgerName.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), name },
            select: { id: true },
        });
        if (existing) {
            await this.prisma.ledgerName.update({
                where: { id: existing.id },
                data: { group },
            });
        }
        else if (group) {
            await this.prisma.ledgerName.create({
                data: { ...(0, scope_1.scopeWhere)(scope), name, group },
            });
        }
    }
    async setNameFields(scope, rawName, input) {
        const name = rawName.trim();
        if (!name || (0, name_memory_util_1.nameKey)(name) === (0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME))
            throw new common_1.BadRequestException('Pick a name');
        const fields = input.flatMap((f) => {
            const value = f.value.trim();
            if (!value)
                return [];
            if (f.kind === 'PHONE') {
                const e164 = (0, phone_number_util_1.toE164)(value);
                if (!e164)
                    throw new common_1.BadRequestException(`“${value}” is not a phone number (add the country code if outside Canada / the US)`);
                return [{ kind: f.kind, label: f.label.trim(), value: e164 }];
            }
            if (f.kind === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
                throw new common_1.BadRequestException(`“${value}” is not an email address`);
            return [
                {
                    kind: f.kind,
                    label: f.label.trim(),
                    value: f.kind === 'EMAIL' ? value.toLowerCase() : value,
                },
            ];
        });
        const data = fields.length
            ? fields
            : client_1.Prisma.DbNull;
        const existing = await this.prisma.ledgerName.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), name },
            select: { id: true },
        });
        if (existing) {
            await this.prisma.ledgerName.update({
                where: { id: existing.id },
                data: { fields: data },
            });
        }
        else if (fields.length) {
            await this.prisma.ledgerName.create({
                data: { ...(0, scope_1.scopeWhere)(scope), name, fields: data },
            });
        }
    }
    async mergeNameFields(scope, source, target) {
        const rows = await this.prisma.ledgerName.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), name: { in: [source, target] } },
            select: { id: true, name: true, fields: true },
        });
        const from = rows.find((r) => (0, name_memory_util_1.nameKey)(r.name) === (0, name_memory_util_1.nameKey)(source));
        const extra = parseNameFields(from?.fields);
        if (!extra.length)
            return;
        const into = rows.find((r) => (0, name_memory_util_1.nameKey)(r.name) === (0, name_memory_util_1.nameKey)(target));
        const own = parseNameFields(into?.fields);
        const seen = new Set(own.map((f) => `${f.kind}|${f.value.toLowerCase()}`));
        const fields = [
            ...own,
            ...extra.filter((f) => !seen.has(`${f.kind}|${f.value.toLowerCase()}`)),
        ];
        if (into)
            await this.prisma.ledgerName.update({
                where: { id: into.id },
                data: { fields },
            });
        else
            await this.prisma.ledgerName.create({
                data: { ...(0, scope_1.scopeWhere)(scope), name: target, fields },
            });
    }
    async createNameGroup(scope, rawName) {
        const name = rawName.trim().slice(0, 64);
        const groups = await this.prisma.customerNameGroup.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            select: { name: true, sortOrder: true },
        });
        const taken = [
            ...exports.BUILTIN_GROUPS.map((g) => g.label),
            ...groups.map((g) => g.name),
        ];
        if (taken.some((t) => t.toLowerCase() === name.toLowerCase()))
            throw new common_1.BadRequestException(`You already have a group "${name}"`);
        const row = await this.prisma.customerNameGroup.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                name,
                sortOrder: groups.reduce((n, g) => Math.max(n, g.sortOrder + 1), 0),
            },
        });
        return { key: `g${row.id}`, label: row.name, id: row.id };
    }
    async renameNameGroup(scope, id, rawName) {
        const found = await this.prisma.customerNameGroup.updateMany({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            data: { name: rawName.trim().slice(0, 64) },
        });
        if (!found.count)
            throw new common_1.NotFoundException('Group not found');
    }
    async deleteNameGroup(scope, id) {
        const found = await this.prisma.customerNameGroup.updateMany({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            data: { deletedAt: new Date() },
        });
        if (!found.count)
            throw new common_1.NotFoundException('Group not found');
        await this.prisma.ledgerName.updateMany({
            where: { ...(0, scope_1.scopeWhere)(scope), group: `g${id}` },
            data: { group: null },
        });
    }
    async searchDescriptions(scope, q) {
        const text = q.trim();
        if (text.length < 2)
            return [];
        const rows = await this.prisma.bankTransaction.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                statement: DONE,
                splitOfId: null,
                description: { contains: text },
            },
            select: { name: true, description: true },
            take: 2000,
        });
        const seen = new Map();
        for (const r of rows) {
            const name = r.name ?? reports_util_1.UNCLARIFIED_NAME;
            const key = (0, name_memory_util_1.descriptionKey)(r.description) || r.description.trim().toLowerCase();
            const k = `${(0, name_memory_util_1.nameKey)(name)}|${key}`;
            if (!seen.has(k))
                seen.set(k, { name, key, description: r.description });
        }
        return [...seen.values()].slice(0, 300);
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
    async carryNameSettings(scope, oldNames, newName) {
        const keys = new Set(oldNames.map(tax_util_1.nameTaxKey));
        const target = (0, tax_util_1.nameTaxKey)(newName);
        keys.delete(target);
        if (!keys.size)
            return;
        const rows = await this.prisma.ledgerName.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { name: true, group: true, taxExempt: true, fields: true },
        });
        if (rows.some((r) => (0, tax_util_1.nameTaxKey)(r.name) === target))
            return;
        const from = rows.find((r) => keys.has((0, tax_util_1.nameTaxKey)(r.name)));
        if (!from)
            return;
        await this.prisma.ledgerName.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                name: newName,
                group: from.group,
                taxExempt: from.taxExempt,
                fields: from.fields ?? client_1.Prisma.DbNull,
            },
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
const TOTAL_SELECT = { id: true, amount: true, splitOfId: true };
const PROVENANCE_SELECT = {
    personalRuleId: true,
    exceptionRuleId: true,
    ruleName: true,
};
function rowShares(rows) {
    const cents = (a) => Math.round(Number(a) * 100);
    const splitCents = new Map();
    for (const r of rows) {
        if (r.splitOfId === null)
            continue;
        splitCents.set(r.splitOfId, (splitCents.get(r.splitOfId) ?? 0) + cents(r.amount));
    }
    return (r) => r.splitOfId !== null
        ? cents(r.amount)
        : cents(r.amount) - (splitCents.get(r.id) ?? 0);
}
function groupDescriptions(rows, rulesById) {
    const byName = new Map();
    const groupFor = (name, key, description) => {
        const groups = byName.get(name) ?? new Map();
        byName.set(name, groups);
        const g = groups.get(key) ?? {
            description,
            categories: new Map(),
            rules: new Map(),
            exceptions: new Map(),
            rows: 0,
        };
        groups.set(key, g);
        return g;
    };
    const exceptionOf = new Map();
    for (const r of rows) {
        const own = r.name ?? reports_util_1.UNCLARIFIED_NAME;
        const name = own.toLowerCase();
        const key = (0, name_memory_util_1.descriptionKey)(r.description) || r.description.trim().toLowerCase();
        const g = groupFor(name, key, r.description);
        g.rows++;
        g.categories.set(r.offsetAccount, (g.categories.get(r.offsetAccount) ?? 0) + 1);
        if (r.personalRuleId !== null)
            g.rules.set(r.personalRuleId, (g.rules.get(r.personalRuleId) ?? 0) + 1);
        const main = r.exceptionRuleId !== null ? r.ruleName : null;
        if (main && main.toLowerCase() !== name) {
            const m = groupFor(main.toLowerCase(), key, r.description);
            const e = m.exceptions.get(name) ?? { name: own, rows: 0 };
            e.rows++;
            m.exceptions.set(name, e);
            const mine = exceptionOf.get(name) ??
                new Map();
            const x = mine.get(`${main.toLowerCase()}|${key}`) ?? {
                main,
                key,
                description: r.description,
                rows: 0,
            };
            x.rows++;
            mine.set(`${main.toLowerCase()}|${key}`, x);
            exceptionOf.set(name, mine);
        }
    }
    const descriptionsOf = new Map();
    for (const [name, groups] of byName) {
        descriptionsOf.set(name, [...groups.entries()]
            .map(([key, g]) => {
            const sorted = [...g.categories.entries()].sort((a, b) => b[1] - a[1]);
            const ruleId = [...g.rules.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
            const rule = ruleId === undefined ? undefined : rulesById.get(ruleId);
            return {
                key,
                description: g.description,
                category: sorted[0]?.[0] ?? chart_of_accounts_1.UNCATEGORIZED,
                rows: g.rows,
                rule: rule &&
                    ruleId !== undefined &&
                    (rule.matchType === 'DESCRIPTION' ||
                        rule.matchType === 'CONTAINS')
                    ? {
                        id: ruleId,
                        matchType: rule.matchType,
                        matchKey: rule.matchKey,
                        text: rule.includeChars ?? rule.matchKey,
                    }
                    : null,
                exceptions: [...g.exceptions.values()].sort((a, b) => b.rows - a.rows),
            };
        })
            .sort((a, b) => b.rows - a.rows ||
            b.exceptions.length - a.exceptions.length ||
            a.description.localeCompare(b.description))
            .slice(0, MAX_DESCRIPTIONS));
    }
    return {
        descriptionsOf,
        exceptionOf: new Map([...exceptionOf.entries()].map(([k, v]) => [k, [...v.values()]])),
    };
}
//# sourceMappingURL=tax.service.js.map