"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitTotals = splitTotals;
exports.remainderOf = remainderOf;
exports.splitProblem = splitProblem;
exports.signedLike = signedLike;
const reconcile_util_1 = require("./reconcile.util");
function splitTotals(rows) {
    const out = new Map();
    for (const r of rows) {
        if (r.splitOfId == null)
            continue;
        out.set(r.splitOfId, (out.get(r.splitOfId) ?? 0) + (0, reconcile_util_1.cents)(r.amount));
    }
    return out;
}
function remainderOf(row, totals) {
    if (row.splitOfId != null)
        return row.amount;
    const taken = totals.get(row.id);
    return taken ? ((0, reconcile_util_1.cents)(row.amount) - taken) / 100 : row.amount;
}
function splitProblem(parentAmount, amounts) {
    if (parentAmount === 0)
        return 'A $0.00 transaction cannot be split';
    for (const a of amounts) {
        if (!Number.isFinite(a) || a <= 0)
            return 'Every split needs an amount above $0.00';
        if (Math.abs((0, reconcile_util_1.cents)(a) - a * 100) > 1e-6)
            return 'Amounts can have at most 2 decimals';
    }
    const total = amounts.reduce((n, a) => n + (0, reconcile_util_1.cents)(a), 0);
    if (total > Math.abs((0, reconcile_util_1.cents)(parentAmount))) {
        return (`The splits add up to $${(total / 100).toFixed(2)}, more than the ` +
            `transaction's $${Math.abs(parentAmount).toFixed(2)}`);
    }
    return null;
}
function signedLike(parentAmount, amount) {
    return parentAmount < 0 ? -Math.abs(amount) : Math.abs(amount);
}
//# sourceMappingURL=splits.util.js.map