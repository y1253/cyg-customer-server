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
var QboImportService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.QboImportService = void 0;
exports.cleanPlan = cleanPlan;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const chart_of_accounts_1 = require("./chart-of-accounts");
const customer_accounts_service_1 = require("./customer-accounts.service");
const name_memory_service_1 = require("./name-memory.service");
const name_memory_util_1 = require("./name-memory.util");
const qbo_import_util_1 = require("./qbo-import.util");
const scope_1 = require("./scope");
const sub_name_parents_1 = require("./sub-name-parents");
const str = (v, max = 191) => typeof v === 'string' ? v.trim().slice(0, max) : '';
let QboImportService = QboImportService_1 = class QboImportService {
    prisma;
    accounts;
    names;
    logger = new common_1.Logger(QboImportService_1.name);
    constructor(prisma, accounts, names) {
        this.prisma = prisma;
        this.accounts = accounts;
        this.names = names;
    }
    async analyze(scope, input) {
        const since = typeof input.since === 'string' && /^\d{4}-\d{2}-\d{2}/.test(input.since)
            ? input.since.slice(0, 10)
            : null;
        const txns = (0, qbo_import_util_1.cleanTxns)(input.txns);
        const [rows, rules] = await Promise.all([
            this.rowsSince(scope, since),
            this.rules(scope),
        ]);
        const result = (0, qbo_import_util_1.analyze)({ since, txns, rows, rules });
        this.logger.log(`${(0, scope_1.bookLabel)(scope)}: QuickBooks import analysed ${txns.length} transaction(s), ` +
            `${result.stats.matched} matched, ${result.names.length} payee(s), ` +
            `${result.questions.length} question(s)`);
        return result;
    }
    async rowsSince(scope, since) {
        const from = since ? new Date(`${since}T00:00:00Z`) : null;
        const rows = await this.prisma.bankTransaction.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                splitOfId: null,
                statement: { status: 'DONE', deletedAt: null },
                ...(from
                    ? {
                        OR: [
                            { postingDate: { gte: from } },
                            { pendingDate: { gte: from } },
                        ],
                    }
                    : {}),
            },
            select: {
                id: true,
                postingDate: true,
                pendingDate: true,
                amount: true,
                description: true,
                name: true,
                offsetAccount: true,
                statement: {
                    select: {
                        accountName: true,
                        plaidAccount: { select: { qboAccountId: true } },
                    },
                },
            },
        });
        return rows.map((r) => {
            const date = r.postingDate ?? r.pendingDate;
            return {
                id: r.id,
                date: date ? date.toISOString().slice(0, 10) : null,
                cents: Math.round(Number(r.amount) * 100),
                description: r.description,
                name: r.name,
                category: r.offsetAccount,
                qboAccountId: r.statement.plaidAccount?.qboAccountId ?? null,
                accountName: r.statement.accountName,
            };
        });
    }
    async rules(scope) {
        const rows = await this.prisma.customerNameRule.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                matchType: { in: ['NAME', 'DESCRIPTION'] },
            },
            select: { matchType: true, matchKey: true, name: true, category: true },
        });
        return rows.map((r) => ({
            matchType: r.matchType === 'NAME' ? 'NAME' : 'DESCRIPTION',
            matchKey: r.matchKey,
            name: r.name,
            category: r.category,
        }));
    }
    async apply(scope, raw) {
        const plan = cleanPlan(raw);
        const errors = [];
        const { map, created } = await this.categories(scope, plan.categories, errors);
        const ours = (c) => c ? (map.get(c.toLowerCase()) ?? null) : null;
        let subNames = 0;
        const subOf = new Map();
        const ensure = async (payee, category) => {
            const k = `${(0, qbo_import_util_1.nameKey)(payee)}\u0000${category.toLowerCase()}`;
            const known = subOf.get(k);
            if (known)
                return known;
            try {
                const sub = await (0, sub_name_parents_1.ensureSubName)(this.prisma, scope, payee, category);
                subOf.set(k, sub.id);
                subNames++;
                return sub.id;
            }
            catch (err) {
                errors.push(`sub-name ${payee} - ${category}: ${String(err)}`);
                return null;
            }
        };
        for (const n of plan.names) {
            if (!n.split)
                continue;
            for (const c of n.splitCategories) {
                const cat = ours(c);
                if (cat && cat !== chart_of_accounts_1.UNCATEGORIZED)
                    await ensure(n.payee, cat);
            }
        }
        const wrappers = await (0, sub_name_parents_1.wrapperNames)(this.prisma, scope);
        const ops = [];
        for (const n of plan.names) {
            for (const alias of n.aliases) {
                if ((0, qbo_import_util_1.nameKey)(alias) === (0, qbo_import_util_1.nameKey)(n.payee))
                    continue;
                ops.push({
                    kind: 'RULE',
                    input: {
                        matchType: 'NAME',
                        matchKey: alias,
                        name: n.payee,
                        category: null,
                        scope: 'ALWAYS',
                    },
                });
            }
            if (n.split) {
                for (const d of n.split) {
                    const cat = ours(d.category);
                    if (!cat || cat === chart_of_accounts_1.UNCATEGORIZED)
                        continue;
                    const subNameId = await ensure(n.payee, cat);
                    if (!subNameId)
                        continue;
                    ops.push({
                        kind: 'RULE',
                        input: {
                            matchType: 'DESCRIPTION',
                            matchKey: d.key,
                            name: n.payee,
                            category: null,
                            scope: 'ALWAYS',
                            replace: true,
                            subNameId,
                        },
                    });
                }
                continue;
            }
            const cat = ours(n.category);
            if (cat && cat !== chart_of_accounts_1.UNCATEGORIZED) {
                if (wrappers.has((0, qbo_import_util_1.nameKey)(n.payee))) {
                    errors.push(`${n.payee} has sub-names, so its category is set on each sub-name — left as it is`);
                }
                else {
                    ops.push({ kind: 'CATEGORY', name: n.payee, category: cat });
                }
            }
        }
        for (const d of plan.descriptions) {
            const cat = ours(d.category);
            let subNameId = null;
            const payeeKey = (0, qbo_import_util_1.nameKey)(d.payee);
            const isWrapper = wrappers.has(payeeKey) ||
                [...subOf.keys()].some((k) => k.startsWith(`${payeeKey}\u0000`));
            if (isWrapper) {
                if (!cat || cat === chart_of_accounts_1.UNCATEGORIZED) {
                    errors.push(`“${d.key}”: ${d.payee} has sub-names and QuickBooks gave no one category — left as it is`);
                    continue;
                }
                subNameId = await ensure(d.payee, cat);
                if (!subNameId)
                    continue;
            }
            ops.push({
                kind: 'RULE',
                input: {
                    matchType: 'DESCRIPTION',
                    matchKey: d.key,
                    name: d.payee,
                    category: subNameId
                        ? null
                        : cat && cat !== chart_of_accounts_1.UNCATEGORIZED
                            ? cat
                            : null,
                    scope: 'ALWAYS',
                    replace: true,
                    subNameId,
                },
            });
        }
        errors.push(...(await this.names.saveImported(scope, ops)));
        this.logger.log(`${(0, scope_1.bookLabel)(scope)}: QuickBooks import saved ${ops.length} rule(s), ` +
            `${created.length} new categor${created.length === 1 ? 'y' : 'ies'}, ` +
            `${subNames} sub-name(s), ${errors.length} problem(s)`);
        return {
            rules: ops.length,
            categoriesCreated: created,
            subNames,
            errors,
        };
    }
    async categories(scope, list, errors) {
        const own = new Set((await this.accounts.list(scope))
            .filter((a) => a.custom)
            .map((a) => a.name));
        const map = new Map();
        const created = [];
        for (const c of list) {
            const name = (0, name_memory_util_1.cleanName)(c.name);
            if (!name)
                continue;
            if ((0, qbo_import_util_1.isUncategorizedQbo)(name)) {
                map.set(name.toLowerCase(), chart_of_accounts_1.UNCATEGORIZED);
                continue;
            }
            const known = (0, chart_of_accounts_1.normalizeAccount)(name, own);
            if (known !== chart_of_accounts_1.UNCATEGORIZED) {
                map.set(name.toLowerCase(), known);
                continue;
            }
            try {
                const made = await this.accounts.create(scope, {
                    name,
                    type: (0, qbo_import_util_1.accountTypeOf)(c.type),
                });
                own.add(made.name);
                created.push(made.name);
                map.set(name.toLowerCase(), made.name);
            }
            catch (err) {
                errors.push(`category “${name}”: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return { map, created };
    }
};
exports.QboImportService = QboImportService;
exports.QboImportService = QboImportService = QboImportService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        customer_accounts_service_1.CustomerAccountsService,
        name_memory_service_1.NameMemoryService])
], QboImportService);
function cleanPlan(raw) {
    const p = (raw ?? {});
    const arr = (v) => Array.isArray(v)
        ? v.filter((x) => x && typeof x === 'object')
        : [];
    return {
        categories: arr(p.categories)
            .map((c) => ({
            name: str(c.name, 120),
            type: typeof c.type === 'string' ? c.type : null,
        }))
            .filter((c) => c.name),
        names: arr(p.names)
            .map((n) => ({
            payee: str(n.payee, 100),
            aliases: Array.isArray(n.aliases)
                ? n.aliases.map((a) => str(a)).filter(Boolean)
                : [],
            category: str(n.category, 120) || null,
            split: Array.isArray(n.split)
                ? arr(n.split)
                    .map((d) => ({
                    key: str(d.key, 255),
                    category: str(d.category, 120),
                }))
                    .filter((d) => d.key && d.category)
                : null,
            splitCategories: Array.isArray(n.splitCategories)
                ? n.splitCategories
                    .map((c) => str(c, 120))
                    .filter(Boolean)
                : [],
        }))
            .filter((n) => n.payee),
        descriptions: arr(p.descriptions)
            .map((d) => ({
            key: str(d.key, 255),
            payee: str(d.payee, 100),
            category: str(d.category, 120) || null,
        }))
            .filter((d) => d.key && d.payee),
    };
}
//# sourceMappingURL=qbo-import.service.js.map