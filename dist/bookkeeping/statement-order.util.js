"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runsNewestFirst = runsNewestFirst;
exports.chronological = chronological;
exports.balanceDirection = balanceDirection;
const cents = (n) => Math.round(n * 100);
function runsNewestFirst(rows) {
    const dates = rows
        .map((r) => r.postingDate ?? null)
        .filter((d) => !!d);
    let down = 0;
    let up = 0;
    for (let i = 1; i < dates.length; i++) {
        if (dates[i] < dates[i - 1])
            down++;
        else if (dates[i] > dates[i - 1])
            up++;
    }
    if (down !== up)
        return down > up;
    let forward = 0;
    let backward = 0;
    for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1];
        const b = rows[i];
        if (a.balanceAfter == null || b.balanceAfter == null)
            continue;
        const diff = cents(b.balanceAfter) - cents(a.balanceAfter);
        if (b.amount != null &&
            Math.abs(diff) === Math.abs(cents(b.amount)) &&
            diff !== 0)
            forward++;
        if (a.amount != null &&
            Math.abs(diff) === Math.abs(cents(a.amount)) &&
            diff !== 0)
            backward++;
    }
    return backward > forward;
}
function chronological(rows) {
    const base = runsNewestFirst(rows) ? [...rows].reverse() : rows;
    const first = base.find((r) => r.postingDate)?.postingDate ?? '';
    let carried = first;
    const keyed = base.map((row, i) => {
        if (row.postingDate)
            carried = row.postingDate;
        return { row, i, date: carried };
    });
    keyed.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i);
    const sorted = keyed.map((k) => k.row);
    return sorted.every((r, i) => r === rows[i]) ? rows : sorted;
}
function balanceDirection(rows, card = false) {
    let plus = 0;
    let minus = 0;
    let prev = null;
    for (const r of rows) {
        if (r.balanceAfter == null) {
            prev = null;
            continue;
        }
        if (prev !== null && r.amount != null) {
            const diff = cents(r.balanceAfter) - prev;
            const amt = cents(r.amount);
            if (diff === amt)
                plus++;
            if (diff === -amt)
                minus++;
        }
        prev = cents(r.balanceAfter);
    }
    if (plus !== minus)
        return plus > minus ? 1 : -1;
    return card ? -1 : 1;
}
//# sourceMappingURL=statement-order.util.js.map