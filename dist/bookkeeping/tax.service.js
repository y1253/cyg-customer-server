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
exports.cleanNameFields = cleanNameFields;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const phone_number_util_1 = require("../customer-auth/phone-number.util");
const prisma_service_1 = require("../prisma/prisma.service");
const chart_of_accounts_1 = require("./chart-of-accounts");
const customer_accounts_service_1 = require("./customer-accounts.service");
const name_memory_util_1 = require("./name-memory.util");
const attachment_name_util_1 = require("./attachment-name.util");
const reports_util_1 = require("./reports.util");
const custom_column_defaults_1 = require("./custom-column-defaults");
const scope_1 = require("./scope");
const split_rules_service_1 = require("./split-rules.service");
const sub_name_parents_1 = require("./sub-name-parents");
const sub_names_util_1 = require("./sub-names.util");
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
        return [
            {
                kind,
                label: typeof o.label === 'string' ? o.label : '',
                value: o.value,
            },
        ];
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
        return r
            ? [
                {
                    kind,
                    mode: r.mode,
                    rate: Number(r.rate),
                    amount: r.amount === null ? null : Number(r.amount),
                },
            ]
            : [];
    }),
    category: a.category,
    active: a.groupId !== null && a.group ? a.group.active : a.active,
    groupId: a.groupId,
});
const AGENCY_INCLUDE = {
    rates: true,
    group: { select: { active: true } },
};
function rateRows(rates) {
    if (new Set(rates.map((r) => r.kind)).size !== rates.length) {
        throw new common_1.BadRequestException('Give In and Out only one rate each');
    }
    return rates.map((r) => {
        const mode = r.mode ?? 'PERCENT';
        if (mode === 'FIXED') {
            if (r.amount === undefined || r.amount <= 0)
                throw new common_1.BadRequestException('Give the fixed amount');
            return { kind: r.kind, mode, rate: '0.000', amount: r.amount.toFixed(2) };
        }
        if (r.rate === undefined)
            throw new common_1.BadRequestException('Give the percentage');
        return { kind: r.kind, mode, rate: r.rate.toFixed(3), amount: null };
    });
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
    splitRules;
    constructor(prisma, accounts, splitRules) {
        this.prisma = prisma;
        this.accounts = accounts;
        this.splitRules = splitRules;
    }
    async settings(scope) {
        const agencies = await this.prisma.taxAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            include: AGENCY_INCLUDE,
            orderBy: { createdAt: 'asc' },
        });
        const groups = await this.prisma.splitGroup.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            orderBy: { createdAt: 'asc' },
        });
        return {
            agencies: agencies.map(toAgency),
            groups: groups.map((g) => ({
                id: g.id,
                name: g.name,
                active: g.active,
                agencyIds: agencies.filter((a) => a.groupId === g.id).map((a) => a.id),
            })),
        };
    }
    async createAgency(scope, dto) {
        const name = await this.checkName(scope, dto.name);
        const category = await this.ruleCategory(scope, dto.category, name);
        const groupId = await this.checkGroupId(scope, dto.groupId);
        const row = await this.prisma.taxAgency.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                name,
                category: category ?? null,
                active: dto.active ?? true,
                groupId: groupId ?? null,
                rates: { create: rateRows(dto.rates) },
            },
            include: AGENCY_INCLUDE,
        });
        if (row.groupId !== null)
            await this.joinGroupPicks(scope, row.id, row.groupId);
        return toAgency(row);
    }
    async updateAgency(scope, id, dto) {
        const current = await this.ownedAgency(scope, id);
        const name = dto.name === undefined
            ? undefined
            : await this.checkName(scope, dto.name, id);
        const category = await this.ruleCategory(scope, dto.category, name ?? current.name);
        const rates = dto.rates && rateRows(dto.rates);
        const groupId = await this.checkGroupId(scope, dto.groupId);
        const nextGroup = groupId === undefined ? current.groupId : groupId;
        let active = nextGroup === null ? dto.active : undefined;
        if (current.groupId !== null && nextGroup !== current.groupId)
            active =
                nextGroup === null && dto.active !== undefined
                    ? dto.active
                    : (await this.prisma.splitGroup.findUnique({
                        where: { id: current.groupId },
                        select: { active: true },
                    }))?.active;
        const row = await this.prisma.taxAgency.update({
            where: { id },
            data: {
                name,
                category,
                active,
                groupId,
                ...(rates && { rates: { deleteMany: {}, create: rates } }),
            },
            include: AGENCY_INCLUDE,
        });
        if (current.groupId !== null && row.groupId !== current.groupId)
            await this.prisma.ledgerNameAgency.updateMany({
                where: { ...(0, scope_1.scopeWhere)(scope), agencyId: row.id, alone: true },
                data: { alone: false },
            });
        if (row.groupId !== null && row.groupId !== current.groupId)
            await this.joinGroupPicks(scope, row.id, row.groupId);
        return toAgency(row);
    }
    async ruleCategory(scope, raw, name) {
        if (raw === undefined)
            return undefined;
        const clean = raw?.trim();
        if (!clean || clean.toLowerCase() === name.toLowerCase())
            return null;
        return this.accounts.validCategory(scope, clean);
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
    async createGroup(scope, dto) {
        const name = await this.checkGroupName(scope, dto.name);
        const row = await this.prisma.splitGroup.create({
            data: { ...(0, scope_1.scopeWhere)(scope), name, active: dto.active ?? true },
        });
        return { id: row.id, name: row.name, active: row.active, agencyIds: [] };
    }
    async updateGroup(scope, id, dto) {
        await this.ownedGroup(scope, id);
        const name = dto.name === undefined
            ? undefined
            : await this.checkGroupName(scope, dto.name, id);
        const row = await this.prisma.splitGroup.update({
            where: { id },
            data: { name, active: dto.active },
        });
        const members = await this.prisma.taxAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null, groupId: id },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
        });
        return {
            id,
            name: row.name,
            active: row.active,
            agencyIds: members.map((m) => m.id),
        };
    }
    async removeGroup(scope, id) {
        const group = await this.ownedGroup(scope, id);
        await this.prisma.$transaction([
            this.prisma.ledgerNameAgency.updateMany({
                where: { ...(0, scope_1.scopeWhere)(scope), alone: true, agency: { groupId: id } },
                data: { alone: false },
            }),
            this.prisma.taxAgency.updateMany({
                where: { ...(0, scope_1.scopeWhere)(scope), groupId: id },
                data: { groupId: null, active: group.active },
            }),
            this.prisma.splitGroup.update({
                where: { id },
                data: { deletedAt: new Date() },
            }),
        ]);
    }
    async ownedGroup(scope, id) {
        const g = await this.prisma.splitGroup.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
        });
        if (!g)
            throw new common_1.NotFoundException('Split group not found');
        return g;
    }
    async checkGroupId(scope, groupId) {
        if (groupId === undefined || groupId === null)
            return groupId;
        await this.ownedGroup(scope, groupId);
        return groupId;
    }
    async checkGroupName(scope, raw, exceptId) {
        const name = raw.trim();
        if (!name)
            throw new common_1.BadRequestException('Give the group a name');
        const others = await this.prisma.splitGroup.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                deletedAt: null,
                NOT: { id: exceptId ?? 0 },
            },
            select: { name: true },
        });
        if (others.some((o) => o.name.toLowerCase() === name.toLowerCase()))
            throw new common_1.BadRequestException(`You already have a split group "${name}"`);
        return name;
    }
    async joinGroupPicks(scope, agencyId, groupId) {
        const members = await this.prisma.taxAgency.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                deletedAt: null,
                groupId,
                NOT: { id: agencyId },
            },
            select: { id: true },
        });
        if (!members.length)
            return;
        const picks = await this.prisma.ledgerNameAgency.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                agencyId: { in: members.map((m) => m.id) },
                alone: false,
            },
            select: { name: true },
        });
        const own = await this.prisma.ledgerNameAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), agencyId },
            select: { name: true },
        });
        const have = new Set(own.map((o) => (0, tax_util_1.nameTaxKey)(o.name)));
        const names = new Map();
        for (const p of picks) {
            const k = (0, tax_util_1.nameTaxKey)(p.name);
            if (!have.has(k) && !names.has(k))
                names.set(k, p.name);
        }
        const fill = await this.prisma.ledgerNameAgency.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                agencyId: { in: members.map((m) => m.id) },
                name: { in: own.map((o) => o.name) },
            },
            select: { name: true, agencyId: true },
        });
        const hasMember = new Set(fill.map((f) => `${(0, tax_util_1.nameTaxKey)(f.name)}|${f.agencyId}`));
        const data = [
            ...[...names.values()].map((name) => ({ name, agencyId })),
            ...own.flatMap((o) => members
                .filter((m) => !hasMember.has(`${(0, tax_util_1.nameTaxKey)(o.name)}|${m.id}`))
                .map((m) => ({ name: o.name, agencyId: m.id }))),
        ];
        if (!data.length)
            return;
        await this.prisma.ledgerNameAgency.createMany({
            data: data.map((d) => ({
                ...(0, scope_1.scopeWhere)(scope),
                ...d,
                appliedAt: new Date(),
            })),
            skipDuplicates: true,
        });
    }
    async ownedAgency(scope, id) {
        const a = await this.prisma.taxAgency.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
        });
        if (!a)
            throw new common_1.NotFoundException('Split rule not found');
        return a;
    }
    async checkName(scope, raw, exceptId) {
        const name = raw.trim();
        if (!name)
            throw new common_1.BadRequestException('Give the split rule a name');
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
            throw new common_1.BadRequestException(`You already have a split rule "${name}"`);
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
                    subNameId: true,
                    splitRuleId: true,
                },
            }),
            this.prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), name: null, statement: DONE },
                select: {
                    ...TOTAL_SELECT,
                    ...PROVENANCE_SELECT,
                    description: true,
                    offsetAccount: true,
                    subNameId: true,
                },
            }),
            this.prisma.ledgerNameAgency.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), agency: { deletedAt: null } },
                select: { name: true, agencyId: true, alone: true },
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
                    subNameId: true,
                },
                orderBy: { createdAt: 'asc' },
            }),
            this.typeContext(scope),
        ]);
        const [placed, ownGroups, fileNames] = await Promise.all([
            this.prisma.ledgerName.findMany({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    OR: [
                        { group: { not: null } },
                        { fields: { not: client_1.Prisma.DbNull } },
                        { manual: true },
                    ],
                },
                select: { name: true, group: true, fields: true, manual: true },
            }),
            this.prisma.customerNameGroup.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                select: { id: true, name: true },
            }),
            this.namesOfFiles(scope),
        ]);
        const groupList = [
            ...exports.BUILTIN_GROUPS,
            ...ownGroups.map((g) => ({ key: `g${g.id}`, label: g.name, id: g.id })),
        ].sort((a, b) => a.label.localeCompare(b.label, undefined, {
            sensitivity: 'base',
            numeric: true,
        }));
        const validGroups = new Set(groupList.map((g) => g.key));
        const groupOf = new Map(placed
            .filter((l) => l.group && validGroups.has(l.group))
            .map((l) => [(0, name_memory_util_1.nameKey)(l.name), l.group]));
        const fieldsOf = new Map(placed.map((l) => [(0, name_memory_util_1.nameKey)(l.name), parseNameFields(l.fields)]));
        const ruleSubIds = rules.flatMap((r) => (r.subNameId ? [r.subNameId] : []));
        const ruleSubs = ruleSubIds.length
            ? await this.prisma.subName.findMany({
                where: { id: { in: ruleSubIds }, bookId: scope.bookId },
                select: { id: true, name: true },
            })
            : [];
        const ruleSubName = new Map(ruleSubs.map((s) => [s.id, s.name]));
        const rulesById = new Map(rules.map((r) => [
            r.id,
            {
                ...r,
                subName: r.subNameId ? (ruleSubName.get(r.subNameId) ?? null) : null,
            },
        ]));
        const { descriptionsOf } = groupDescriptions([...named, ...nameless], rulesById);
        const oneTimeSubs = new Set((await this.prisma.subName.findMany({
            where: { bookId: scope.bookId, NOT: { splitKey: '' } },
            select: { id: true },
        })).map((s) => s.id));
        const subDescriptions = Object.fromEntries([
            ...groupDescriptions(named.flatMap((r) => r.subNameId && !r.splitOfId && !oneTimeSubs.has(r.subNameId)
                ? [{ ...r, name: `#${r.subNameId}` }]
                : []), rulesById).descriptionsOf,
        ].map(([k, v]) => [Number(k.slice(1)), v]));
        const printed = new Map();
        for (const r of [...named, ...nameless]) {
            const k = (0, name_memory_util_1.descriptionKey)(r.description);
            if (k && !printed.has(k))
                printed.set(k, r.description);
        }
        for (const r of rules) {
            if (r.matchType !== 'DESCRIPTION' || !r.subNameId)
                continue;
            const list = (subDescriptions[r.subNameId] ??= []);
            if (list.some((d) => d.key === r.matchKey))
                continue;
            if (list.length >= MAX_DESCRIPTIONS)
                continue;
            list.push({
                key: r.matchKey,
                description: printed.get(r.matchKey) ?? r.matchKey,
                category: r.category ?? chart_of_accounts_1.UNCATEGORIZED,
                rows: 0,
                rule: {
                    id: r.id,
                    matchType: 'DESCRIPTION',
                    matchKey: r.matchKey,
                    text: r.matchKey,
                    subName: ruleSubName.get(r.subNameId),
                },
                exceptions: [],
            });
        }
        const usualCategory = new Map();
        for (const g of [...groups].sort((a, b) => b._count._all - a._count._all))
            if (g.name && !usualCategory.has(g.name.toLowerCase()))
                usualCategory.set(g.name.toLowerCase(), g.offsetAccount);
        const { exceptionOf, subExceptionOf } = await this.exceptionsOf(scope, [...named, ...nameless], rules, descriptionsOf, subDescriptions, usualCategory);
        const subContains = {};
        for (const r of rules) {
            if (r.matchType !== 'CONTAINS' || !r.subNameId)
                continue;
            (subContains[r.subNameId] ??= []).push({
                key: r.matchKey,
                text: r.includeChars ?? r.matchKey,
                category: r.category,
                rows: [...named, ...nameless].filter((t) => !t.splitOfId && t.personalRuleId === r.id).length,
            });
        }
        const shareOf = rowShares([...named, ...nameless]);
        const totalOf = new Map();
        for (const r of named) {
            const key = r.name.toLowerCase();
            totalOf.set(key, (totalOf.get(key) ?? 0) + shareOf(r));
        }
        const agenciesOf = new Map();
        const aloneKeys = new Set();
        for (const p of picks) {
            const key = (0, tax_util_1.nameTaxKey)(p.name);
            agenciesOf.set(key, [...(agenciesOf.get(key) ?? []), p.agencyId]);
            if (p.alone)
                aloneKeys.add(key);
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
                agencyAlone: aloneKeys.has((0, tax_util_1.nameTaxKey)(name)),
                fields: fieldsOf.get(key) ?? [],
                descriptions: descriptionsOf.get(key) ?? [],
                followsContains: rules
                    .filter((r) => r.matchType === 'CONTAINS' && r.name && (0, name_memory_util_1.nameKey)(r.name) === key)
                    .map((r) => ({
                    key: r.matchKey,
                    text: r.includeChars ?? r.matchKey,
                    category: r.category,
                    rows: [...named, ...nameless].filter((t) => !t.splitOfId && t.personalRuleId === r.id).length,
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
        const unclarifiedExceptions = !!descriptionsOf
            .get((0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME))
            ?.some((d) => d.exceptions.length);
        if (nameless.length || unclarifiedExceptions) {
            names.push({
                name: reports_util_1.UNCLARIFIED_NAME,
                category: chart_of_accounts_1.UNCATEGORIZED,
                otherCategories: 0,
                type: 'OTHER',
                rows: nameless.length,
                total: nameless.reduce((n, r) => n + shareOf(r), 0) / 100,
                agencyIds: agenciesOf.get((0, tax_util_1.nameTaxKey)(null)) ?? [],
                agencyAlone: aloneKeys.has((0, tax_util_1.nameTaxKey)(null)),
                fields: [],
                descriptions: [
                    ...unrecognized.slice(0, MAX_DESCRIPTIONS).map((u) => ({
                        key: u.key,
                        description: u.sampleDescription,
                        category: u.category,
                        rows: u.rows,
                        rule: null,
                        exceptions: descriptionsOf
                            .get((0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME))
                            ?.find((d) => d.key === u.key)?.exceptions ?? [],
                    })),
                    ...(descriptionsOf
                        .get((0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME))
                        ?.filter((d) => d.exceptions.length &&
                        !unrecognized
                            .slice(0, MAX_DESCRIPTIONS)
                            .some((u) => u.key === d.key)) ?? []),
                ],
                followsContains: [],
                exceptionOf: exceptionOf.get((0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME)) ?? [],
                group: 'OTHER',
                ruleKey: '',
                rule: null,
                unclarified: true,
            });
            names.sort((a, b) => a.name.localeCompare(b.name));
        }
        const listed = new Set(names.map((n) => (0, name_memory_util_1.nameKey)(n.name)));
        for (const s of await this.prisma.subName.findMany({
            where: { bookId: scope.bookId },
            select: { name: true },
        }))
            listed.add((0, name_memory_util_1.nameKey)(s.name));
        const extra = [
            ...placed.filter((l) => l.manual).map((l) => l.name),
            ...fileNames,
        ];
        for (const name of extra) {
            const key = (0, name_memory_util_1.nameKey)(name);
            if (listed.has(key))
                continue;
            listed.add(key);
            names.push({
                name,
                category: chart_of_accounts_1.UNCATEGORIZED,
                otherCategories: 0,
                type: typeOfCategory(chart_of_accounts_1.UNCATEGORIZED, ctx),
                rows: 0,
                total: 0,
                agencyIds: agenciesOf.get((0, tax_util_1.nameTaxKey)(name)) ?? [],
                agencyAlone: aloneKeys.has((0, tax_util_1.nameTaxKey)(name)),
                fields: fieldsOf.get(key) ?? [],
                descriptions: [],
                followsContains: [],
                exceptionOf: [],
                group: groupOf.get(key) ?? typeOfCategory(chart_of_accounts_1.UNCATEGORIZED, ctx),
                ruleKey: key,
                rule: null,
            });
        }
        names.sort((a, b) => a.name.localeCompare(b.name));
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
        return {
            names,
            unrecognized,
            containsRules,
            groups: groupList,
            subDescriptions,
            subContains,
            subExceptionOf,
        };
    }
    async exceptionsOf(scope, rows, rules, descriptionsOf, subDescriptions, usualCategory) {
        const subs = await this.prisma.subName.findMany({
            where: { bookId: scope.bookId },
            select: {
                id: true,
                name: true,
                nameId: true,
                category: true,
                splitKey: true,
            },
        });
        const subName = new Map(subs.map((s) => [s.id, s.name]));
        const subById = new Map(subs.map((s) => [s.id, s]));
        const oneTimeOwner = (r) => {
            const sub = r.subNameId !== null ? subById.get(r.subNameId) : undefined;
            if (!sub || sub.splitKey === '' || !r.name)
                return null;
            const plain = subs.find((s) => s.splitKey === '' &&
                s.nameId === sub.nameId &&
                s.category === sub.category);
            return plain
                ? { label: plain.name, name: r.name, subNameId: plain.id }
                : { label: r.name, name: r.name, subNameId: null };
        };
        const ownerOf = new Map(rules
            .filter((r) => r.matchType === 'DESCRIPTION')
            .map((r) => [r.matchKey, r]));
        const byId = new Map(rows.map((r) => [r.id, r]));
        const listed = new Set(descriptionsOf.keys());
        const exceptionOf = new Map();
        const subExceptionOf = new Map();
        for (const r of rows) {
            const key = (0, name_memory_util_1.descriptionKey)(r.description) || r.description.trim().toLowerCase();
            const parent = r.splitOfId ? byId.get(r.splitOfId) : undefined;
            let main = parent
                ? !r.splitRuleId &&
                    (0, name_memory_util_1.nameKey)(r.name ?? '') !== (0, name_memory_util_1.nameKey)(parent.name ?? '') &&
                    r.name
                    ? {
                        label: parent.name ?? reports_util_1.UNCLARIFIED_NAME,
                        name: parent.name ?? null,
                        subNameId: null,
                    }
                    : null
                : ((0, name_memory_util_1.exceptionOwner)({ ...r, name: r.name ?? null }, ownerOf.get(key), (id) => subName.get(id)) ?? oneTimeOwner(r));
            if (!main &&
                !parent &&
                r.manualEdit &&
                r.exceptionRuleId === null &&
                r.name &&
                (0, name_memory_util_1.nameKey)(r.ruleName ?? r.name) === (0, name_memory_util_1.nameKey)(r.name)) {
                const usual = usualCategory.get(r.name.toLowerCase());
                if (usual && usual !== r.offsetAccount)
                    main = {
                        label: r.name,
                        name: r.name,
                        subNameId: null,
                        categoryOnly: true,
                    };
            }
            if (!main)
                continue;
            if (main.subNameId === null &&
                main.name &&
                !listed.has(main.name.toLowerCase()))
                main = { label: reports_util_1.UNCLARIFIED_NAME, name: null, subNameId: null };
            const own = (r.subNameId !== null && subName.get(r.subNameId)) ||
                r.name ||
                reports_util_1.UNCLARIFIED_NAME;
            const list = main.subNameId !== null
                ? (subDescriptions[main.subNameId] ??= [])
                : (() => {
                    const k = (main.name ?? reports_util_1.UNCLARIFIED_NAME).toLowerCase();
                    const l = descriptionsOf.get(k) ?? [];
                    descriptionsOf.set(k, l);
                    return l;
                })();
            let d = list.find((x) => x.key === key);
            if (!d) {
                const rule = ownerOf.get(key);
                d = {
                    key,
                    description: (parent ?? r).description,
                    category: rule?.category ?? r.offsetAccount,
                    rows: 0,
                    rule: null,
                    exceptions: [],
                };
                list.push(d);
            }
            const label = own;
            let e = d.exceptions.find((x) => x.name.toLowerCase() === label.toLowerCase() &&
                (x.category ?? null) === (main.categoryOnly ? r.offsetAccount : null));
            if (!e) {
                e = {
                    name: label,
                    rows: 0,
                    ...(main.categoryOnly && { category: r.offsetAccount }),
                    ...(parent && { split: true }),
                };
                d.exceptions.push(e);
            }
            e.rows++;
            d.exceptions.sort((a, b) => b.rows - a.rows);
            if (main.categoryOnly)
                continue;
            const mine = (r.subNameId !== null
                ? subExceptionOf.get(r.subNameId)
                : exceptionOf.get(own.toLowerCase())) ??
                new Map();
            if (r.subNameId !== null)
                subExceptionOf.set(r.subNameId, mine);
            else
                exceptionOf.set(own.toLowerCase(), mine);
            const xKey = `${main.label.toLowerCase()}|${key}`;
            const x = mine.get(xKey) ?? {
                main: main.label,
                key,
                description: (parent ?? r).description,
                rows: 0,
                ...(parent && { split: true }),
            };
            x.rows++;
            mine.set(xKey, x);
        }
        return {
            exceptionOf: new Map([...exceptionOf.entries()].map(([k, v]) => [k, [...v.values()]])),
            subExceptionOf: Object.fromEntries([...subExceptionOf.entries()].map(([k, v]) => [k, [...v.values()]])),
        };
    }
    async namesOfFiles(scope) {
        const rows = await this.prisma.transactionAttachment.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                deletedAt: null,
                NOT: { kind: 'AUDIO', status: 'DOCUMENT' },
            },
            select: {
                nameOverride: true,
                extracted: true,
                transaction: {
                    select: {
                        name: true,
                        statement: { select: { deletedAt: true, status: true } },
                    },
                },
            },
        });
        const spellings = new Map();
        for (const r of rows) {
            const t = r.transaction;
            const live = t && !t.statement.deletedAt && t.statement.status === 'DONE' ? t : null;
            const name = (0, attachment_name_util_1.attachmentName)({
                nameOverride: r.nameOverride,
                transaction: live,
                reading: r.extracted,
            });
            if (!name)
                continue;
            const key = (0, name_memory_util_1.nameKey)(name);
            const m = spellings.get(key) ?? new Map();
            m.set(name, (m.get(name) ?? 0) + 1);
            spellings.set(key, m);
        }
        return [...spellings.values()].map((m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
    }
    async addName(scope, rawName, group) {
        const name = rawName.replace(/\s+/g, ' ').trim().slice(0, 191);
        if (!name || (0, name_memory_util_1.nameKey)(name) === (0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME))
            throw new common_1.BadRequestException('Give the name');
        if (group)
            await this.setNameGroup(scope, name, group);
        const rows = await this.prisma.ledgerName.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { id: true, name: true },
        });
        const existing = rows.find((r) => (0, name_memory_util_1.nameKey)(r.name) === (0, name_memory_util_1.nameKey)(name));
        if (existing) {
            await this.prisma.ledgerName.update({
                where: { id: existing.id },
                data: { manual: true },
            });
            return existing.name;
        }
        await this.prisma.ledgerName.create({
            data: { ...(0, scope_1.scopeWhere)(scope), name, manual: true },
        });
        return name;
    }
    async checkGroup(scope, group) {
        if (!group || !/^g\d+$/.test(group))
            return;
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
    async setNameGroup(scope, rawName, group) {
        const name = rawName.trim();
        if (!name || (0, name_memory_util_1.nameKey)(name) === (0, name_memory_util_1.nameKey)(reports_util_1.UNCLARIFIED_NAME))
            throw new common_1.BadRequestException('Pick a name');
        await (0, sub_name_parents_1.refuseWrapper)(this.prisma, scope, name);
        await this.checkGroup(scope, group);
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
        await (0, sub_name_parents_1.refuseWrapper)(this.prisma, scope, name);
        const data = cleanNameFields(input);
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
        else if (data !== client_1.Prisma.DbNull) {
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
    async setNameAgencies(scope, name, agencyIds, alone = false) {
        const clean = name.trim();
        if (!clean)
            throw new common_1.BadRequestException('Which name?');
        await (0, sub_name_parents_1.refuseWrapper)(this.prisma, scope, clean);
        await this.writePicks(scope, clean, agencyIds, alone);
        return this.names(scope);
    }
    async writePicks(scope, clean, agencyIds, alone = false) {
        let ids = [...new Set(agencyIds)];
        if (alone && ids.length !== 1)
            throw new common_1.BadRequestException('Pick one split rule to apply on its own.');
        if (alone) {
            const owned = await this.prisma.taxAgency.count({
                where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null, id: ids[0] },
            });
            if (!owned)
                throw new common_1.NotFoundException('Split rule not found');
        }
        if (ids.length && !alone) {
            const owned = await this.prisma.taxAgency.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null, id: { in: ids } },
                select: { groupId: true },
            });
            if (owned.length !== ids.length)
                throw new common_1.NotFoundException('Split rule not found');
            const units = new Set(owned.map((a, i) => (a.groupId === null ? `r${i}` : `g${a.groupId}`)));
            if (units.size > 1)
                throw new common_1.BadRequestException('A name takes one split rule or one split group — put the rules in a group to apply several together.');
            const groupIds = [
                ...new Set(owned.flatMap((a) => (a.groupId === null ? [] : [a.groupId]))),
            ];
            if (groupIds.length) {
                const members = await this.prisma.taxAgency.findMany({
                    where: {
                        ...(0, scope_1.scopeWhere)(scope),
                        deletedAt: null,
                        groupId: { in: groupIds },
                    },
                    select: { id: true },
                });
                ids = [...new Set([...ids, ...members.map((m) => m.id)])];
            }
        }
        const key = (0, tax_util_1.nameTaxKey)(clean);
        const existing = await this.prisma.ledgerNameAgency.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { id: true, name: true, agencyId: true, alone: true },
        });
        const mine = existing.filter((e) => (0, tax_util_1.nameTaxKey)(e.name) === key);
        const kept = new Set(mine
            .filter((e) => ids.includes(e.agencyId) && e.alone === alone)
            .map((e) => e.agencyId));
        const added = ids.filter((agencyId) => !kept.has(agencyId));
        await this.prisma.$transaction([
            this.prisma.ledgerNameAgency.deleteMany({
                where: {
                    id: {
                        in: mine.filter((e) => !kept.has(e.agencyId)).map((e) => e.id),
                    },
                },
            }),
            this.prisma.ledgerNameAgency.createMany({
                data: added.map((agencyId) => ({
                    ...(0, scope_1.scopeWhere)(scope),
                    name: clean,
                    agencyId,
                    alone,
                    appliedAt: new Date(),
                })),
            }),
        ]);
        if (added.length)
            await this.splitRules.apply(scope, { names: [clean], ruleIds: added });
    }
    async moveSubNameKeys(scope, oldName, newName) {
        const from = (0, tax_util_1.nameTaxKey)(oldName);
        const to = (0, tax_util_1.nameTaxKey)(newName);
        if (from === to)
            return;
        const picks = await this.prisma.ledgerNameAgency.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { id: true, name: true },
        });
        const mine = picks.filter((p) => (0, tax_util_1.nameTaxKey)(p.name) === from);
        if (mine.length) {
            const theirs = picks.some((p) => (0, tax_util_1.nameTaxKey)(p.name) === to);
            const ids = mine.map((p) => p.id);
            if (theirs)
                await this.prisma.ledgerNameAgency.deleteMany({
                    where: { id: { in: ids } },
                });
            else
                await this.prisma.ledgerNameAgency.updateMany({
                    where: { id: { in: ids } },
                    data: { name: newName },
                });
        }
        await this.moveNameFiles(scope, [oldName], newName);
    }
    async dropSubNameKeys(scope, name, parent) {
        const key = (0, tax_util_1.nameTaxKey)(name);
        const picks = await this.prisma.ledgerNameAgency.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { id: true, name: true },
        });
        const ids = picks
            .filter((p) => (0, tax_util_1.nameTaxKey)(p.name) === key)
            .map((p) => p.id);
        if (ids.length)
            await this.prisma.ledgerNameAgency.deleteMany({
                where: { id: { in: ids } },
            });
        if (parent)
            await this.moveNameFiles(scope, [name], parent);
    }
    async carryAgencies(scope, oldNames, newName) {
        const keys = new Set(oldNames.map(tax_util_1.nameTaxKey));
        if (!keys.size)
            return;
        const rows = await this.prisma.ledgerNameAgency.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { name: true, agencyId: true, alone: true },
        });
        const target = (0, tax_util_1.nameTaxKey)(newName);
        if (rows.some((r) => (0, tax_util_1.nameTaxKey)(r.name) === target))
            return;
        const from = oldNames
            .map(tax_util_1.nameTaxKey)
            .find((k) => rows.some((r) => (0, tax_util_1.nameTaxKey)(r.name) === k));
        if (from === undefined)
            return;
        const add = rows.filter((r) => (0, tax_util_1.nameTaxKey)(r.name) === from);
        await this.prisma.ledgerNameAgency.createMany({
            data: add.map(({ agencyId, alone }) => ({
                ...(0, scope_1.scopeWhere)(scope),
                name: newName,
                agencyId,
                alone,
                appliedAt: new Date(),
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
        await this.moveNameFiles(scope, oldNames, newName);
        await this.copyNameRow(scope, keys, target, newName);
        await this.moveSubNames(scope, oldNames, newName);
    }
    async copyNameRow(scope, keys, target, newName) {
        const rows = await this.prisma.ledgerName.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: {
                id: true,
                name: true,
                group: true,
                taxExempt: true,
                fields: true,
                manual: true,
            },
        });
        const from = rows.find((r) => keys.has((0, tax_util_1.nameTaxKey)(r.name)));
        if (!from)
            return;
        const there = rows.find((r) => (0, tax_util_1.nameTaxKey)(r.name) === target);
        if (there) {
            await (0, custom_column_defaults_1.moveNameAnswers)(this.prisma, { nameId: from.id }, { nameId: there.id });
            return;
        }
        const made = await this.prisma.ledgerName.create({
            data: {
                ...(0, scope_1.scopeWhere)(scope),
                name: newName,
                group: from.group,
                taxExempt: from.taxExempt,
                fields: from.fields ?? client_1.Prisma.DbNull,
                manual: from.manual,
            },
            select: { id: true },
        });
        await (0, custom_column_defaults_1.moveNameAnswers)(this.prisma, { nameId: from.id }, { nameId: made.id });
    }
    async moveSubNames(scope, oldNames, newName) {
        const target = (0, tax_util_1.nameTaxKey)(newName);
        const old = [
            ...new Set(oldNames.map(tax_util_1.nameTaxKey).filter((k) => k && k !== target)),
        ];
        if (!old.length)
            return;
        await this.prisma.bankTransaction.updateMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                splitOfId: { not: null },
                name: { in: old },
            },
            data: { name: newName },
        });
        const names = await this.prisma.ledgerName.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            select: { id: true, name: true },
        });
        const fromIds = names
            .filter((n) => old.includes((0, tax_util_1.nameTaxKey)(n.name)))
            .map((n) => n.id);
        if (!fromIds.length)
            return;
        const subs = await this.prisma.subName.findMany({
            where: { bookId: scope.bookId, nameId: { in: fromIds } },
        });
        if (!subs.length)
            return;
        const into = names.find((n) => (0, tax_util_1.nameTaxKey)(n.name) === target)?.id ??
            (await this.prisma.ledgerName.create({
                data: { ...(0, scope_1.scopeWhere)(scope), name: newName },
                select: { id: true },
            })).id;
        for (const sub of subs) {
            const same = await this.prisma.subName.findFirst({
                where: {
                    bookId: scope.bookId,
                    nameId: into,
                    category: sub.category,
                    splitKey: sub.splitKey,
                },
                select: { id: true },
            });
            if (same) {
                await this.prisma.bankTransaction.updateMany({
                    where: { ...(0, scope_1.scopeWhere)(scope), subNameId: sub.id },
                    data: { subNameId: same.id },
                });
                await this.prisma.subName.delete({ where: { id: sub.id } });
                const kept = await this.prisma.subName.findUnique({
                    where: { id: same.id },
                    select: { name: true },
                });
                if (kept)
                    await this.moveSubNameKeys(scope, sub.name, kept.name);
            }
            else {
                const name = sub.renamed
                    ? sub.name
                    : sub.splitKey
                        ? (0, sub_names_util_1.splitSubNameOf)(newName, sub.category, (0, sub_names_util_1.splitLabelOf)(sub.name, names.find((n) => n.id === sub.nameId)?.name ?? '', sub.category))
                        : (0, sub_names_util_1.subNameOf)(newName, sub.category);
                await this.prisma.subName.update({
                    where: { id: sub.id },
                    data: { nameId: into, name },
                });
                await this.moveSubNameKeys(scope, sub.name, name);
            }
        }
    }
    async moveNameFiles(scope, oldNames, newName) {
        const keys = new Set(oldNames.map(attachment_name_util_1.nameKeyOf));
        keys.delete((0, attachment_name_util_1.nameKeyOf)(newName));
        if (!keys.size)
            return;
        const files = await this.prisma.transactionAttachment.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), nameOverride: { not: null } },
            select: { id: true, nameOverride: true },
        });
        const ids = files
            .filter((f) => keys.has((0, attachment_name_util_1.nameKeyOf)(f.nameOverride)))
            .map((f) => f.id);
        if (ids.length) {
            await this.prisma.transactionAttachment.updateMany({
                where: { id: { in: ids } },
                data: { nameOverride: newName.trim().slice(0, 191) },
            });
        }
        await this.prisma.nameFolder.updateMany({
            where: { ...(0, scope_1.scopeWhere)(scope), name: { in: [...keys] } },
            data: { name: (0, attachment_name_util_1.nameKeyOf)(newName) },
        });
    }
};
exports.TaxService = TaxService;
exports.TaxService = TaxService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        customer_accounts_service_1.CustomerAccountsService,
        split_rules_service_1.SplitRulesService])
], TaxService);
const MAX_DESCRIPTIONS = 25;
const TOTAL_SELECT = { id: true, amount: true, splitOfId: true };
const PROVENANCE_SELECT = {
    personalRuleId: true,
    exceptionRuleId: true,
    ruleName: true,
    manualEdit: true,
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
    for (const r of rows) {
        const name = (r.name ?? reports_util_1.UNCLARIFIED_NAME).toLowerCase();
        const key = (0, name_memory_util_1.descriptionKey)(r.description) || r.description.trim().toLowerCase();
        const groups = byName.get(name) ?? new Map();
        byName.set(name, groups);
        const g = groups.get(key) ?? {
            description: r.description,
            categories: new Map(),
            rules: new Map(),
            rows: 0,
        };
        groups.set(key, g);
        g.rows++;
        g.categories.set(r.offsetAccount, (g.categories.get(r.offsetAccount) ?? 0) + 1);
        if (r.personalRuleId !== null)
            g.rules.set(r.personalRuleId, (g.rules.get(r.personalRuleId) ?? 0) + 1);
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
                        ...(rule.subName && { subName: rule.subName }),
                    }
                    : null,
                exceptions: [],
            };
        })
            .sort((a, b) => b.rows - a.rows || a.description.localeCompare(b.description))
            .slice(0, MAX_DESCRIPTIONS));
    }
    return { descriptionsOf };
}
function cleanNameFields(input) {
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
    return fields.length
        ? fields
        : client_1.Prisma.DbNull;
}
//# sourceMappingURL=tax.service.js.map