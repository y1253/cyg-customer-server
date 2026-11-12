"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mismatchPairs = mismatchPairs;
exports.queueChainRereads = queueChainRereads;
exports.chainHint = chainHint;
exports.loadChainHint = loadChainHint;
const client_1 = require("@prisma/client");
const opening_balance_query_1 = require("./opening-balance.query");
const opening_balance_util_1 = require("./opening-balance.util");
const statement_problem_util_1 = require("./statement-problem.util");
const scope_1 = require("./scope");
function mismatchPairs(statements, accounts) {
    const ids = new Set();
    for (const r of (0, opening_balance_util_1.openingChain)(statements)) {
        if (r.reason?.kind !== 'MISMATCH')
            continue;
        if (accounts && !accounts.has(r.bankAccount))
            continue;
        ids.add(r.reason.previousStatementId);
        ids.add(r.statementId);
    }
    return [...ids];
}
async function queueChainRereads(prisma, scope, accountNames) {
    try {
        const chain = await (0, opening_balance_query_1.loadOpeningStatements)(prisma, scope);
        const accounts = accountNames
            ? new Set(accountNames.map((n) => n ?? 'Bank account'))
            : undefined;
        const ids = mismatchPairs(chain, accounts);
        if (!ids.length)
            return 0;
        const { count } = await prisma.bankStatement.updateMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                id: { in: ids },
                deletedAt: null,
                status: client_1.StatementStatus.DONE,
                chainRereadAt: null,
                source: { not: 'PLAID' },
            },
            data: { status: client_1.StatementStatus.PENDING, chainRereadAt: new Date() },
        });
        return count;
    }
    catch {
        return 0;
    }
}
const chainTime = (s) => (s.periodStart ?? s.periodEnd)?.getTime() ?? -Infinity;
const isoDay = (d) => d ? d.toISOString().slice(0, 10) : null;
function chainHint(statements, id) {
    const self = statements.find((s) => s.id === id);
    if (!self)
        return null;
    const account = self.accountName ?? 'Bank account';
    const list = statements
        .filter((s) => (s.accountName ?? 'Bank account') === account)
        .sort((a, b) => chainTime(a) - chainTime(b) || a.id - b.id);
    const at = list.findIndex((s) => s.id === id);
    const prev = at > 0 ? list[at - 1] : null;
    const next = at >= 0 && at < list.length - 1 ? list[at + 1] : null;
    const read = (n) => (n === null ? 'not read' : (0, statement_problem_util_1.money)(n));
    const lines = [];
    if (prev) {
        const ending = prev.closingBalance ??
            (prev.openingBalance === null ? null : prev.openingBalance + prev.net);
        if (ending !== null) {
            lines.push(`- The previous statement of this account${prev.periodEnd ? ` (ending ${isoDay(prev.periodEnd)})` : ''} ends at ${(0, statement_problem_util_1.money)(ending)}. This statement's opening balance was read as ${read(self.openingBalance)}.`);
        }
    }
    if (next?.openingBalance != null) {
        lines.push(`- The next statement of this account${next.periodStart ? ` (starting ${isoDay(next.periodStart)})` : ''} opens at ${(0, statement_problem_util_1.money)(next.openingBalance)}. This statement's closing balance was read as ${read(self.closingBalance)}.`);
    }
    if (!lines.length)
        return null;
    return [
        "This statement's balances do not carry over from / to the statements next to it in the same account, so one of them was read wrong:",
        ...lines,
        'Read the printed opening balance, closing balance and EVERY transaction on this page again, very carefully. Copy exactly what is PRINTED — never change a figure or a row to make it fit; if this statement really prints a different balance, keep it.',
    ].join('\n');
}
async function loadChainHint(prisma, scope, row) {
    try {
        const chain = await (0, opening_balance_query_1.loadOpeningStatements)(prisma, scope);
        const all = [
            ...chain.filter((s) => s.id !== row.id),
            ...chain.bridges.filter((s) => s.id !== row.id),
            {
                ...row,
                openingBalance: (0, opening_balance_util_1.num)(row.openingBalance),
                closingBalance: (0, opening_balance_util_1.num)(row.closingBalance),
                net: 0,
            },
        ];
        return chainHint(all, row.id);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=statement-continuity.js.map