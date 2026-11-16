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
var SplitRulesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SplitRulesService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const customer_accounts_service_1 = require("./customer-accounts.service");
const ledger_util_1 = require("./ledger.util");
const reconcile_util_1 = require("./reconcile.util");
const scope_1 = require("./scope");
const split_rules_util_1 = require("./split-rules.util");
const splits_util_1 = require("./splits.util");
const sub_name_parents_1 = require("./sub-name-parents");
const tax_util_1 = require("./tax.util");
const DONE = { deletedAt: null, status: client_1.StatementStatus.DONE };
let SplitRulesService = SplitRulesService_1 = class SplitRulesService {
    prisma;
    accounts;
    logger = new common_1.Logger(SplitRulesService_1.name);
    constructor(prisma, accounts) {
        this.prisma = prisma;
        this.accounts = accounts;
    }
    async rules(scope) {
        const rows = await this.prisma.taxAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null, active: true },
            include: { rates: true },
            orderBy: { createdAt: 'asc' },
        });
        return new Map(rows.map((a) => [
            a.id,
            {
                id: a.id,
                name: a.name,
                category: a.category,
                rates: a.rates.map((r) => ({
                    kind: r.kind,
                    mode: r.mode,
                    rate: Number(r.rate),
                    amount: r.amount === null ? null : Number(r.amount),
                })),
            },
        ]));
    }
    async apply(scope, target = {}) {
        const rules = await this.rules(scope);
        if (!rules.size)
            return 0;
        const picks = await this.prisma.ledgerNameAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), appliedAt: { not: null } },
            select: { name: true, agencyId: true },
            orderBy: { agencyId: 'asc' },
        });
        const wantRule = (id) => rules.has(id) && (!target.ruleIds || target.ruleIds.includes(id));
        const rulesOf = new Map();
        for (const p of picks) {
            if (!wantRule(p.agencyId))
                continue;
            const k = (0, tax_util_1.nameTaxKey)(p.name);
            rulesOf.set(k, [...(rulesOf.get(k) ?? []), p.agencyId]);
        }
        if (!rulesOf.size)
            return 0;
        const ownSubs = await this.ownRuleSubNames(scope);
        const parents = await this.parentsFor(scope, target, ownSubs);
        let made = 0;
        const touched = [];
        for (const p of parents) {
            const lines = this.linesOf(p, ownSubs);
            const done = new Set(p.splits
                .filter((s) => s.splitRuleId !== null)
                .map((s) => `${s.ruleSourceId}:${s.splitRuleId}`));
            let n = 0;
            for (const line of lines) {
                const ids = (rulesOf.get(line.key) ?? []).filter((id) => !done.has(`${line.sourceId}:${id}`));
                if (!ids.length)
                    continue;
                const splits = (0, split_rules_util_1.ruleSplits)(line.amount, ids.map((id) => rules.get(id)));
                if (!splits.length)
                    continue;
                n += await this.write(scope, p, line, splits);
            }
            if (n) {
                made += n;
                touched.push(p.id);
            }
        }
        if (touched.length)
            await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, scope, touched);
        return made;
    }
    async applyToNew(scope, transactionIds) {
        if (!transactionIds.length)
            return;
        try {
            const made = await this.apply(scope, { transactionIds });
            if (made)
                this.logger.log(`book ${scope.bookId}: ${made} rule split(s) on ${transactionIds.length} new row(s)`);
        }
        catch (err) {
            this.logger.warn(`book ${scope.bookId}: split rules not applied to new rows: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async ownRuleSubNames(scope) {
        const subs = await this.prisma.subName.findMany({
            where: { bookId: scope.bookId, ownAgencies: true },
            select: { id: true, name: true },
        });
        return new Map(subs.map((s) => [s.id, s.name]));
    }
    async parentsFor(scope, target, ownSubs) {
        const or = [];
        if (target.names) {
            const keys = new Set(target.names.map(tax_util_1.nameTaxKey));
            const subIds = [...ownSubs]
                .filter(([, name]) => keys.has((0, tax_util_1.nameTaxKey)(name)))
                .map(([id]) => id);
            or.push({ name: { in: target.names } });
            if (keys.has((0, tax_util_1.nameTaxKey)(null)))
                or.push({ name: null });
            if (subIds.length) {
                or.push({ subNameId: { in: subIds } });
                or.push({ splits: { some: { subNameId: { in: subIds } } } });
            }
        }
        return this.prisma.bankTransaction.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                splitOfId: null,
                statement: DONE,
                ...(target.transactionIds && { id: { in: target.transactionIds } }),
                ...(or.length && { OR: or }),
            },
            include: { splits: { orderBy: { id: 'asc' } } },
        });
    }
    linesOf(p, ownSubs) {
        const keyOf = (r) => (0, tax_util_1.nameTaxKey)((r.subNameId !== null && ownSubs.get(r.subNameId)) || r.name);
        const totals = (0, splits_util_1.splitTotals)(p.splits.map((s) => ({
            splitOfId: s.splitOfId,
            amount: Number(s.amount),
        })));
        return [
            {
                parentId: p.id,
                sourceId: p.id,
                key: keyOf(p),
                amount: (0, splits_util_1.remainderOf)({ ...p, amount: Number(p.amount) }, totals),
            },
            ...p.splits
                .filter((s) => s.splitRuleId === null)
                .map((s) => ({
                parentId: p.id,
                sourceId: s.id,
                key: keyOf(s),
                amount: Number(s.amount),
            })),
        ];
    }
    async write(scope, p, line, splits, names = []) {
        const parentAmount = Number(p.amount);
        const bank = parentAmount < 0 ? p.creditAccount : p.debitAccount;
        const subOf = new Map();
        for (const s of splits) {
            if (subOf.has(s.category))
                continue;
            subOf.set(s.category, p.name && s.category !== p.offsetAccount
                ? (await (0, sub_name_parents_1.ensureSubName)(this.prisma, scope, p.name, s.category)).id
                : null);
        }
        const taken = splits.reduce((n, s) => n + (0, reconcile_util_1.cents)(s.amount), 0);
        await this.prisma.$transaction([
            ...splits.map((s, i) => this.prisma.bankTransaction.create({
                data: {
                    ...(0, scope_1.scopeWhere)(scope),
                    statementId: p.statementId,
                    position: p.position,
                    pendingDate: p.pendingDate,
                    postingDate: p.postingDate,
                    description: p.description,
                    name: names[i] ?? p.name,
                    subNameId: names[i] ? null : subOf.get(s.category),
                    amount: (0, splits_util_1.signedLike)(parentAmount, s.amount).toFixed(2),
                    offsetAccount: s.category,
                    ...(0, ledger_util_1.doubleEntry)(parentAmount, bank, s.category),
                    manualEdit: true,
                    splitOfId: p.id,
                    splitRuleId: s.ruleId,
                    ruleSourceId: line.sourceId,
                },
            })),
            ...(line.sourceId !== p.id
                ? [
                    this.prisma.bankTransaction.update({
                        where: { id: line.sourceId },
                        data: {
                            amount: (0, splits_util_1.signedLike)(parentAmount, Math.max(0, Math.abs((0, reconcile_util_1.cents)(line.amount)) - taken) / 100).toFixed(2),
                        },
                    }),
                ]
                : []),
        ]);
        return splits.length;
    }
    onApplicationBootstrap() {
        setTimeout(() => void this.convertAll(), 80_000).unref();
    }
    async convertAll() {
        try {
            const books = await this.prisma.ledgerNameAgency.groupBy({
                by: ['customerId', 'bookId', 'companyId'],
                where: { appliedAt: null },
            });
            for (const b of books) {
                const made = await this.convertBook(b);
                if (made)
                    this.logger.log(`book ${b.bookId}: ${made} tax line(s) written as rule splits`);
            }
        }
        catch (err) {
            this.logger.warn(`tax lines not converted: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async convertBook(scope) {
        const picks = await this.prisma.ledgerNameAgency.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), appliedAt: null },
            select: { name: true, agencyId: true, lineName: true },
        });
        if (!picks.length)
            return 0;
        const [agencyRows, named, ctx, ownSubs] = await Promise.all([
            this.prisma.taxAgency.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null, active: true },
                include: { rates: true },
                orderBy: { createdAt: 'asc' },
            }),
            this.prisma.transactionTax.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), name: { not: null } },
                select: { transactionId: true, agencyId: true, name: true },
            }),
            this.typeContext(scope),
            this.ownRuleSubNames(scope),
        ]);
        const agencies = agencyRows.map((a) => ({
            id: a.id,
            name: a.name,
            rates: Object.fromEntries(a.rates
                .filter((r) => r.mode === 'PERCENT')
                .map((r) => [r.kind, Number(r.rate)])),
        }));
        const agenciesOf = new Map();
        for (const p of picks) {
            const key = (0, tax_util_1.nameTaxKey)(p.name);
            agenciesOf.set(key, [...(agenciesOf.get(key) ?? []), p.agencyId]);
        }
        const nameOf = new Map(named.map((n) => [`${n.transactionId}:${n.agencyId}`, n.name]));
        const alwaysOf = new Map(picks.flatMap((p) => p.lineName
            ? [[`${(0, tax_util_1.nameTaxKey)(p.name)}:${p.agencyId}`, p.lineName]]
            : []));
        const parents = await this.prisma.bankTransaction.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), splitOfId: null, statement: DONE },
            include: { splits: { orderBy: { id: 'asc' } } },
        });
        let made = 0;
        for (const p of parents) {
            const lines = this.linesOf(p, ownSubs);
            const taxed = (0, tax_util_1.nameTaxLines)(lines.map((l) => ({
                id: l.sourceId,
                name: l.key,
                offsetAccount: l.sourceId === p.id
                    ? p.offsetAccount
                    : p.splits.find((s) => s.id === l.sourceId).offsetAccount,
                amount: l.amount,
            })), agenciesOf, agencies, ctx);
            if (!taxed.size)
                continue;
            for (const line of lines) {
                const tl = taxed.get(line.sourceId);
                if (!tl?.length)
                    continue;
                const amounts = (0, tax_util_1.includedTaxes)(line.amount, tl.map((t) => t.rate));
                const splits = tl
                    .map((t, i) => ({
                    ruleId: t.agencyId,
                    category: t.agency,
                    amount: amounts[i],
                }))
                    .filter((s) => s.amount > 0);
                if (!splits.length)
                    continue;
                const names = tl.map((t) => nameOf.get(`${line.sourceId}:${t.agencyId}`) ??
                    alwaysOf.get(`${line.key}:${t.agencyId}`) ??
                    null);
                made += await this.write(scope, p, line, splits, names);
            }
        }
        await this.prisma.$transaction([
            this.prisma.ledgerNameAgency.updateMany({
                where: { ...(0, scope_1.scopeWhere)(scope), appliedAt: null },
                data: { appliedAt: new Date() },
            }),
            this.prisma.transactionTax.deleteMany({ where: (0, scope_1.scopeWhere)(scope) }),
        ]);
        const used = await this.prisma.bankTransaction.groupBy({
            by: ['subNameId'],
            where: { ...(0, scope_1.scopeWhere)(scope), subNameId: { not: null } },
        });
        const usedIds = new Set(used.map((u) => u.subNameId));
        const names = new Set(agencyRows.map((a) => a.name));
        const empty = (await this.prisma.subName.findMany({
            where: { bookId: scope.bookId },
            select: { id: true, category: true },
        })).filter((s) => names.has(s.category) && !usedIds.has(s.id));
        if (empty.length)
            await this.prisma.subName.deleteMany({
                where: { id: { in: empty.map((s) => s.id) } },
            });
        await (0, sub_name_parents_1.syncParentSubNames)(this.prisma, scope);
        return made;
    }
    async typeContext(scope) {
        const [overrides, custom, agencies] = await Promise.all([
            this.accounts.overrides(scope),
            this.accounts.types(scope),
            this.prisma.taxAgency.findMany({
                where: (0, scope_1.scopeWhere)(scope),
                select: { name: true },
            }),
        ]);
        return {
            overrides,
            custom,
            liabilities: new Set(agencies.map((a) => a.name)),
        };
    }
};
exports.SplitRulesService = SplitRulesService;
exports.SplitRulesService = SplitRulesService = SplitRulesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        customer_accounts_service_1.CustomerAccountsService])
], SplitRulesService);
//# sourceMappingURL=split-rules.service.js.map