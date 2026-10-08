"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENING_POSITION = exports.OPENING_STATEMENT_SELECT = exports.num = exports.STARTING_BALANCE = void 0;
exports.openingRows = openingRows;
exports.ledgerOrder = ledgerOrder;
const chart_of_accounts_1 = require("./chart-of-accounts");
const ledger_util_1 = require("./ledger.util");
const reconcile_util_1 = require("./reconcile.util");
exports.STARTING_BALANCE = 'Starting balance';
function openingRows(statements) {
    const byAccount = new Map();
    for (const s of statements) {
        const bank = s.accountName ?? 'Bank account';
        byAccount.set(bank, [...(byAccount.get(bank) ?? []), s]);
    }
    const time = (d) => d?.getTime() ?? -Infinity;
    const out = [];
    for (const [bankAccount, list] of byAccount) {
        list.sort((a, b) => time(a.periodStart) - time(b.periodStart) || a.id - b.id);
        list.forEach((s, i) => {
            if (s.openingBalance === null || (0, reconcile_util_1.cents)(s.openingBalance) === 0)
                return;
            const prev = list[i - 1];
            if (prev && endingsOf(prev).includes((0, reconcile_util_1.cents)(s.openingBalance)))
                return;
            const amount = (0, reconcile_util_1.cents)(s.openingBalance) / 100;
            out.push({
                statementId: s.id,
                bankAccount,
                amount,
                postingDate: s.periodStart,
                description: exports.STARTING_BALANCE,
                offsetAccount: chart_of_accounts_1.OWNERS_LOAN,
                ...(0, ledger_util_1.doubleEntry)(amount, bankAccount, chart_of_accounts_1.OWNERS_LOAN),
            });
        });
    }
    return out;
}
function endingsOf(s) {
    if (s.closingBalance !== null)
        return [(0, reconcile_util_1.cents)(s.closingBalance)];
    if (s.openingBalance === null)
        return [];
    const open = (0, reconcile_util_1.cents)(s.openingBalance);
    const net = (0, reconcile_util_1.cents)(s.net);
    return [open + net, open - net];
}
const num = (d) => d === null ? null : Number(d);
exports.num = num;
exports.OPENING_STATEMENT_SELECT = {
    id: true,
    accountName: true,
    bankName: true,
    filename: true,
    openingBalance: true,
    closingBalance: true,
    periodStart: true,
    periodEnd: true,
};
exports.OPENING_POSITION = -1;
function ledgerOrder(a, b) {
    const t = (d) => d?.getTime() ?? -Infinity;
    const ta = t(a.postingDate);
    const tb = t(b.postingDate);
    if (ta !== tb)
        return ta < tb ? -1 : 1;
    return a.statementId - b.statementId || a.position - b.position;
}
//# sourceMappingURL=opening-balance.util.js.map