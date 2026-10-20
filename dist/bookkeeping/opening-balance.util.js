"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENING_POSITION = exports.OPENING_STATEMENT_SELECT = exports.num = exports.isCreditCard = exports.CREDIT_CARD = exports.STARTING_BALANCE = void 0;
exports.openingRows = openingRows;
exports.startsByAccount = startsByAccount;
exports.endingsOf = endingsOf;
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
        let carried = [];
        for (const s of list) {
            const continues = s.openingBalance !== null && carried.includes((0, reconcile_util_1.cents)(s.openingBalance));
            carried = endingsOf(s, carried);
            if (carried.length > MAX_CARRIED)
                carried = [];
            if (s.openingBalance === null || (0, reconcile_util_1.cents)(s.openingBalance) === 0)
                continue;
            if (continues)
                continue;
            const sign = (0, exports.isCreditCard)(s.accountKind) ? -1 : 1;
            const amount = (sign * (0, reconcile_util_1.cents)(s.openingBalance)) / 100;
            out.push({
                statementId: s.id,
                bankAccount,
                amount,
                postingDate: s.periodStart,
                description: exports.STARTING_BALANCE,
                offsetAccount: chart_of_accounts_1.OWNERS_LOAN,
                ...(0, ledger_util_1.doubleEntry)(amount, bankAccount, chart_of_accounts_1.OWNERS_LOAN),
            });
        }
    }
    return out;
}
function startsByAccount(rows) {
    const out = new Map();
    for (const r of rows) {
        const list = out.get(r.bankAccount) ?? [];
        list.push({
            statementId: r.statementId,
            date: r.postingDate?.toISOString().slice(0, 10) ?? null,
            amount: r.amount,
        });
        out.set(r.bankAccount, list);
    }
    for (const list of out.values())
        list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    return out;
}
exports.CREDIT_CARD = 'CREDIT_CARD';
const isCreditCard = (kind) => kind === exports.CREDIT_CARD;
exports.isCreditCard = isCreditCard;
function endingsOf(s, openings = []) {
    const out = [];
    if (s.closingBalance !== null)
        out.push((0, reconcile_util_1.cents)(s.closingBalance));
    const net = (0, reconcile_util_1.cents)(s.net);
    const opens = s.openingBalance !== null ? [(0, reconcile_util_1.cents)(s.openingBalance)] : openings;
    for (const open of opens)
        out.push(open + net, open - net);
    return [...new Set(out.flatMap((c) => [c, -c]))];
}
const MAX_CARRIED = 64;
const num = (d) => d === null ? null : Number(d);
exports.num = num;
exports.OPENING_STATEMENT_SELECT = {
    id: true,
    accountName: true,
    accountKind: true,
    currency: true,
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