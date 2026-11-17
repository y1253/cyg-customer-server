"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitTotals = splitTotals;
exports.remainderOf = remainderOf;
exports.splitProblem = splitProblem;
exports.signedLike = signedLike;
exports.subtreeIds = subtreeIds;
exports.splitTree = splitTree;
exports.childSplitProblem = childSplitProblem;
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
        if (!Number.isFinite(a) || a < 0)
            return 'A split amount cannot be negative';
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
function subtreeIds(rows, id) {
    const children = new Map();
    for (const r of rows) {
        if (r.parentSplitId == null)
            continue;
        children.set(r.parentSplitId, [
            ...(children.get(r.parentSplitId) ?? []),
            r.id,
        ]);
    }
    const out = [];
    const seen = new Set();
    const walk = (at) => {
        if (seen.has(at))
            return;
        seen.add(at);
        out.push(at);
        for (const c of children.get(at) ?? [])
            walk(c);
    };
    walk(id);
    return out;
}
function splitTree(rows) {
    const ids = new Set(rows.map((r) => r.id));
    const sorted = [...rows].sort((a, b) => a.id - b.id);
    const children = new Map();
    for (const r of sorted) {
        const at = r.parentSplitId != null && ids.has(r.parentSplitId)
            ? r.parentSplitId
            : null;
        children.set(at, [...(children.get(at) ?? []), r]);
    }
    const out = [];
    const seen = new Set();
    const walk = (at, depth) => {
        for (const r of children.get(at) ?? []) {
            if (seen.has(r.id))
                continue;
            seen.add(r.id);
            out.push({ row: r, depth });
            walk(r.id, depth + 1);
        }
    };
    walk(null, 0);
    return out;
}
function childSplitProblem(available, next, parentLabel) {
    if (!Number.isFinite(next) || next < 0)
        return 'A split amount cannot be negative';
    if (Math.abs((0, reconcile_util_1.cents)(next) - next * 100) > 1e-6)
        return 'Amounts can have at most 2 decimals';
    if ((0, reconcile_util_1.cents)(next) > (0, reconcile_util_1.cents)(available))
        return (`$${next.toFixed(2)} is more than “${parentLabel}” has left ` +
            `($${available.toFixed(2)})`);
    return null;
}
//# sourceMappingURL=splits.util.js.map