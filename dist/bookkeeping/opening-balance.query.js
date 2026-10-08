"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadOpeningStatements = loadOpeningStatements;
const client_1 = require("@prisma/client");
const opening_balance_util_1 = require("./opening-balance.util");
async function loadOpeningStatements(prisma, customerId) {
    const done = { customerId, deletedAt: null, status: client_1.StatementStatus.DONE };
    const [statements, sums] = await Promise.all([
        prisma.bankStatement.findMany({
            where: done,
            select: opening_balance_util_1.OPENING_STATEMENT_SELECT,
        }),
        prisma.bankTransaction.groupBy({
            by: ['statementId'],
            where: { customerId, statement: done },
            _sum: { amount: true },
        }),
    ]);
    const netOf = new Map(sums.map((s) => [s.statementId, Number(s._sum.amount ?? 0)]));
    return statements.map((s) => ({
        ...s,
        openingBalance: (0, opening_balance_util_1.num)(s.openingBalance),
        closingBalance: (0, opening_balance_util_1.num)(s.closingBalance),
        net: netOf.get(s.id) ?? 0,
    }));
}
//# sourceMappingURL=opening-balance.query.js.map