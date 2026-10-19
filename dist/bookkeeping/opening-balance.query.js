"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.effectiveCurrency = void 0;
exports.loadOpeningStatements = loadOpeningStatements;
exports.accountCurrencies = accountCurrencies;
const client_1 = require("@prisma/client");
const opening_balance_util_1 = require("./opening-balance.util");
const scope_1 = require("./scope");
async function loadOpeningStatements(prisma, scope) {
    const done = {
        ...(0, scope_1.scopeWhere)(scope),
        deletedAt: null,
        status: client_1.StatementStatus.DONE,
    };
    const [statements, sums, currencies] = await Promise.all([
        prisma.bankStatement.findMany({
            where: done,
            select: opening_balance_util_1.OPENING_STATEMENT_SELECT,
        }),
        prisma.bankTransaction.groupBy({
            by: ['statementId'],
            where: { ...(0, scope_1.scopeWhere)(scope), statement: done, splitOfId: null },
            _sum: { amount: true },
        }),
        accountCurrencies(prisma, scope),
    ]);
    const netOf = new Map(sums.map((s) => [s.statementId, Number(s._sum.amount ?? 0)]));
    return statements.map((s) => ({
        ...s,
        currency: (0, exports.effectiveCurrency)(s, currencies),
        openingBalance: (0, opening_balance_util_1.num)(s.openingBalance),
        closingBalance: (0, opening_balance_util_1.num)(s.closingBalance),
        net: netOf.get(s.id) ?? 0,
    }));
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