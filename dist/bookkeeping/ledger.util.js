"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.doubleEntry = doubleEntry;
exports.parseIsoDate = parseIsoDate;
exports.toMoney = toMoney;
exports.buildLedgerRows = buildLedgerRows;
const chart_of_accounts_1 = require("./chart-of-accounts");
function doubleEntry(amount, bankAccount, offsetAccount) {
    return amount < 0
        ? { debitAccount: offsetAccount, creditAccount: bankAccount }
        : { debitAccount: bankAccount, creditAccount: offsetAccount };
}
function parseIsoDate(raw) {
    if (!raw)
        return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    if (!m)
        return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}
function toMoney(raw) {
    const n = typeof raw === 'string' ? Number(raw.replace(/[$,\s]/g, '')) : raw;
    if (typeof n !== 'number' || !Number.isFinite(n))
        return null;
    return (Math.round(n * 100) / 100).toFixed(2);
}
function buildLedgerRows(lines, bankAccount) {
    const rows = [];
    for (const line of lines) {
        const amount = toMoney(line.amount);
        if (amount === null)
            continue;
        const offset = (0, chart_of_accounts_1.normalizeAccount)(line.offsetAccount);
        rows.push({
            position: rows.length,
            pendingDate: parseIsoDate(line.pendingDate),
            postingDate: parseIsoDate(line.postingDate),
            description: (line.description || '').trim().slice(0, 512) || '(no description)',
            name: (line.name ?? '').trim().slice(0, 191) || null,
            amount,
            balanceAfter: line.balanceAfter === null || line.balanceAfter === undefined
                ? null
                : toMoney(line.balanceAfter),
            offsetAccount: offset,
            ...doubleEntry(Number(amount), bankAccount, offset),
        });
    }
    return rows;
}
//# sourceMappingURL=ledger.util.js.map