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
    async reports(customerId, from, to) {
        const done = { customerId, deletedAt: null, status: client_1.StatementStatus.DONE };
        const [rows, statements, taxes, agencies, customTypes, overrides] = await Promise.all([
            this.prisma.bankTransaction.findMany({
                where: { customerId, statement: done },
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
            (0, opening_balance_query_1.loadOpeningStatements)(this.prisma, customerId),
            this.tax.linesFor(customerId),
            this.tax.agencyNames(customerId),
            this.accounts.types(customerId),
            this.accounts.overrides(customerId),
        ]);
        const creditCards = new Set(statements
            .filter((s) => (0, opening_balance_util_1.isCreditCard)(s.accountKind))
            .map((s) => s.accountName ?? 'Bank account'));
        const fx = await this.fx.context(customerId, statements);
        const entries = [];
        const home = (statementId, date, amount, bankAccount) => {
            const { home: converted } = fx.convert(statementId, date, amount);
            entries.push({ statementId, bankAccount, amount, home: converted });
            return converted;
        };
        const openings = (0, opening_balance_util_1.openingRows)(statements).map((o) => ({
            amount: home(o.statementId, day(o.postingDate), o.amount, o.bankAccount),
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
                    amount: home(r.statementId, rowDate, e.amount, bankAccount),
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
        }));
        return (0, reports_util_1.buildReports)([...ledgerRows, ...revaluations], from, to, {
            liabilityAccounts: agencies,
            customTypes,
            overrides,
            creditCards,
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