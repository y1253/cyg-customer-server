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
const reports_util_1 = require("./reports.util");
const day = (d) => d ? d.toISOString().slice(0, 10) : null;
let ReportsService = class ReportsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async reports(customerId, from, to) {
        const done = { customerId, deletedAt: null, status: client_1.StatementStatus.DONE };
        const [rows, statements] = await Promise.all([
            this.prisma.bankTransaction.findMany({
                where: { customerId, statement: done },
                select: {
                    amount: true,
                    offsetAccount: true,
                    debitAccount: true,
                    creditAccount: true,
                    postingDate: true,
                    pendingDate: true,
                    statement: { select: { periodEnd: true } },
                },
            }),
            this.prisma.bankStatement.findMany({
                where: done,
                select: { accountName: true, openingBalance: true, periodStart: true },
                orderBy: [{ periodStart: 'asc' }, { id: 'asc' }],
            }),
        ]);
        const openings = [];
        const seen = new Set();
        for (const s of statements) {
            const bankAccount = s.accountName ?? 'Bank account';
            if (seen.has(bankAccount))
                continue;
            seen.add(bankAccount);
            if (s.openingBalance !== null) {
                openings.push({ bankAccount, amount: Number(s.openingBalance) });
            }
        }
        return (0, reports_util_1.buildReports)(rows.map((r) => {
            const amount = Number(r.amount);
            return {
                amount,
                offsetAccount: r.offsetAccount,
                bankAccount: amount < 0 ? r.creditAccount : r.debitAccount,
                date: day(r.postingDate) ??
                    day(r.pendingDate) ??
                    day(r.statement.periodEnd),
            };
        }), openings, from, to);
    }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReportsService);
//# sourceMappingURL=reports.service.js.map