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
exports.ReportsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const opening_balance_query_1 = require("./opening-balance.query");
const opening_balance_util_1 = require("./opening-balance.util");
const reports_util_1 = require("./reports.util");
const customer_accounts_service_1 = require("./customer-accounts.service");
const splits_util_1 = require("./splits.util");
const fx_service_1 = require("./fx.service");
const scope_1 = require("./scope");
const tax_service_1 = require("./tax.service");
const tax_util_1 = require("./tax.util");
const day = (d) => d ? d.toISOString().slice(0, 10) : null;
let ReportsService = class ReportsService {
    prisma;
    tax;
    accounts;
    fx;
    constructor(prisma, tax, accounts, fx) {
        this.prisma = prisma;
        this.tax = tax;
        this.accounts = accounts;
        this.fx = fx;
    }
    async reports(scope, from, to) {
        const done = {
            ...(0, scope_1.scopeWhere)(scope),
            deletedAt: null,
            status: client_1.StatementStatus.DONE,
        };
        const [rows, statements, taxes, agencies, customTypes, overrides] = await Promise.all([
            this.prisma.bankTransaction.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), statement: done },
                select: {
                    id: true,
                    splitOfId: true,
                    name: true,
                    amount: true,
                    offsetAccount: true,
                    debitAccount: true,
                    creditAccount: true,
                    postingDate: true,
                    pendingDate: true,
                    statementId: true,
                    statement: { select: { periodEnd: true } },
                },
            }),
            (0, opening_balance_query_1.loadOpeningStatements)(this.prisma, scope),
            this.tax.linesFor(scope),
            this.tax.agencyNames(scope),
            this.accounts.types(scope),
            this.accounts.overrides(scope),
        ]);
        const creditCards = new Set(statements
            .filter((s) => (0, opening_balance_util_1.isCreditCard)(s.accountKind))
            .map((s) => s.accountName ?? 'Bank account'));
        const fx = await this.fx.context(scope, statements);
        const entries = [];
        const home = (statementId, date, amount, bankAccount) => {
            const { home: converted } = fx.convert(statementId, date, amount);
            entries.push({ statementId, bankAccount, amount, home: converted });
            return fx.isForeign(statementId)
                ? { amount: converted, foreign: amount }
                : { amount: converted };
        };
        const seen = new Map();
        for (const s of statements) {
            const bank = s.accountName ?? 'Bank account';
            seen.set(bank, (seen.get(bank) ?? new Set()).add(fx.currencyOf(s.id)));
        }
        const bankCurrencies = new Map([...seen]
            .filter(([, cs]) => cs.size === 1)
            .map(([bank, cs]) => {
            const currency = [...cs][0];
            return [bank, { currency, foreign: currency !== fx.home }];
        }));
        const openings = (0, opening_balance_util_1.openingRows)(statements).map((o) => ({
            ...home(o.statementId, day(o.postingDate), o.amount, o.bankAccount),
            offsetAccount: o.offsetAccount,
            bankAccount: o.bankAccount,
            date: day(o.postingDate),
        }));
        const totals = (0, splits_util_1.splitTotals)(rows.map((r) => ({ splitOfId: r.splitOfId, amount: Number(r.amount) })));
        const ledgerRows = [
            ...openings,
            ...rows.flatMap((r) => {
                const amount = (0, splits_util_1.remainderOf)({ ...r, amount: Number(r.amount) }, totals);
                const date = day(r.postingDate) ??
                    day(r.pendingDate) ??
                    day(r.statement.periodEnd);
                const bankAccount = Number(r.amount) < 0 ? r.creditAccount : r.debitAccount;
                const split = (0, tax_util_1.taxSplit)({ ...r, amount }, taxes.get(r.id) ?? []);
                const rowDate = day(r.postingDate) ?? day(r.pendingDate);
                return [split.parent, ...split.taxes].map((e) => ({
                    ...home(r.statementId, rowDate, e.amount, bankAccount),
                    offsetAccount: e.offsetAccount,
                    bankAccount,
                    date,
                    name: r.name,
                }));
            }),
        ];
        const revaluations = fx.revaluations(entries).map((f) => ({
            amount: f.homeAmount,
            offsetAccount: f.offsetAccount,
            bankAccount: f.bankAccount,
            date: f.date,
            name: null,
            ...(fx.isForeign(f.statementId) && { foreign: 0 }),
        }));
        return (0, reports_util_1.buildReports)([...ledgerRows, ...revaluations], from, to, {
            liabilityAccounts: agencies,
            customTypes,
            overrides,
            creditCards,
            bankCurrencies,
        });
    }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        tax_service_1.TaxService,
        customer_accounts_service_1.CustomerAccountsService,
        fx_service_1.FxService])
], ReportsService);
//# sourceMappingURL=reports.service.js.map