"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.effectiveCurrency = void 0;
exports.loadOpeningStatements = loadOpeningStatements;
exports.accountCurrencies = accountCurrencies;
const client_1 = require("@prisma/client");
const opening_balance_util_1 = require("./opening-balance.util");
const scope_1 = require("./scope");
async function loadOpeningStatements(prisma, scope) {
    const where = (status) => ({
        ...(0, scope_1.scopeWhere)(scope),
        deletedAt: null,
        status,
    });
    const read = {
        ...(0, scope_1.scopeWhere)(scope),
        deletedAt: null,
        status: { in: [client_1.StatementStatus.DONE, client_1.StatementStatus.NEEDS_REVIEW] },
    };
    const [statements, review, sums, currencies] = await Promise.all([
        prisma.bankStatement.findMany({
            where: where(client_1.StatementStatus.DONE),
            select: opening_balance_util_1.OPENING_STATEMENT_SELECT,
        }),
        prisma.bankStatement.findMany({
            where: where(client_1.StatementStatus.NEEDS_REVIEW),
            select: opening_balance_util_1.OPENING_STATEMENT_SELECT,
        }),
        prisma.bankTransaction.groupBy({
            by: ['statementId'],
            where: { ...(0, scope_1.scopeWhere)(scope), statement: read, splitOfId: null },
            _sum: { amount: true },
        }),
        accountCurrencies(prisma, scope),
    ]);
    const netOf = new Map(sums.map((s) => [s.statementId, Number(s._sum.amount ?? 0)]));
    const view = (s) => ({
        ...s,
        currency: (0, exports.effectiveCurrency)(s, currencies),
        openingBalance: (0, opening_balance_util_1.num)(s.openingBalance),
        closingBalance: (0, opening_balance_util_1.num)(s.closingBalance),
        net: netOf.get(s.id) ?? 0,
    });
    const done = statements.map(view);
    const bridges = review.map(view);
    return Object.assign(done, { bridges });
}
async function accountCurrencies(prisma, scope) {
    const rows = await prisma.customerAccountCurrency.findMany({
        where: (0, scope_1.scopeWhere)(scope),
        select: { account: true, currency: true },
    });
    return new Map(rows.map((r) => [r.account, r.currency]));
}
const effectiveCurrency = (s, set) => (s.accountName && set.get(s.accountName)) || s.currency;
exports.effectiveCurrency = effectiveCurrency;
//# sourceMappingURL=opening-balance.query.js.map