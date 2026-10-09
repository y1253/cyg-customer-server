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
const tax_service_1 = require("./tax.service");
const tax_util_1 = require("./tax.util");
const day = (d) => d ? d.toISOString().slice(0, 10) : null;
let ReportsService = class ReportsService {
    prisma;
    tax;
    constructor(prisma, tax) {
        this.prisma = prisma;
        this.tax = tax;
    }
    async reports(customerId, from, to) {
        const done = { customerId, deletedAt: null, status: client_1.StatementStatus.DONE };
        const [rows, statements, taxes, agencies] = await Promise.all([
            this.prisma.bankTransaction.findMany({
                where: { customerId, statement: done },
                select: {
                    id: true,
                    amount: true,
                    offsetAccount: true,
                    debitAccount: true,
                    creditAccount: true,
                    postingDate: true,
                    pendingDate: true,
                    statement: { select: { periodEnd: true } },
                },
            }),
            (0, opening_balance_query_1.loadOpeningStatements)(this.prisma, customerId),
            this.tax.linesFor(customerId),
            this.tax.agencyNames(customerId),
        ]);
        const openings = (0, opening_balance_util_1.openingRows)(statements).map((o) => ({
            amount: o.amount,
            offsetAccount: o.offsetAccount,
            bankAccount: o.bankAccount,
            date: day(o.postingDate),
        }));
        return (0, reports_util_1.buildReports)([
            ...openings,
            ...rows.flatMap((r) => {
                const amount = Number(r.amount);
                const date = day(r.postingDate) ??
                    day(r.pendingDate) ??
                    day(r.statement.periodEnd);
                const bankAccount = amount < 0 ? r.creditAccount : r.debitAccount;
                const split = (0, tax_util_1.taxSplit)({ ...r, amount }, taxes.get(r.id) ?? []);
                return [split.parent, ...split.taxes].map((e) => ({
                    amount: e.amount,
                    offsetAccount: e.offsetAccount,
                    bankAccount,
                    date,
                }));
            }),
        ], from, to, agencies);
    }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        tax_service_1.TaxService])
], ReportsService);
//# sourceMappingURL=reports.service.js.map