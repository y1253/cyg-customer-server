"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_FOR_AI = exports.TIP_SLACK = exports.DAYS_AFTER = exports.DAYS_BEFORE = void 0;
exports.shortlist = shortlist;
exports.obviousMatch = obviousMatch;
const reconcile_util_1 = require("./reconcile.util");
exports.DAYS_BEFORE = 5;
exports.DAYS_AFTER = 15;
exports.TIP_SLACK = 0.2;
exports.MAX_FOR_AI = 30;
const DAY_MS = 86_400_000;
const dayNumber = (iso) => {
    const t = Date.parse(`${iso}T00:00:00Z`);
    return Number.isFinite(t) ? Math.round(t / DAY_MS) : null;
};
function shortlist(q, rows) {
    const want = q.total != null && q.total > 0 ? (0, reconcile_util_1.cents)(q.total) : null;
    const day = q.date ? dayNumber(q.date) : null;
    const scored = [];
    for (const row of rows) {
        if (q.kind === 'RECEIPT' && row.amount >= 0)
            continue;
        const have = Math.abs((0, reconcile_util_1.cents)(row.amount));
        if (have === 0)
            continue;
        let exact = 1;
        if (want != null) {
            if (have < want || have > Math.round(want * (1 + exports.TIP_SLACK)))
                continue;
            exact = have === want ? 0 : 1;
        }
        let gap = 0;
        if (day != null && row.date) {
            const d = dayNumber(row.date);
            if (d != null) {
                if (d < day - exports.DAYS_BEFORE || d > day + exports.DAYS_AFTER)
                    continue;
                gap = Math.abs(d - day);
            }
        }
        const twin = want != null && row.attachedTotals.includes(want) ? 1 : 0;
        scored.push({ row, rank: [twin, exact, gap, row.id] });
    }
    scored.sort((a, b) => {
        for (let i = 0; i < a.rank.length; i++) {
            if (a.rank[i] !== b.rank[i])
                return a.rank[i] - b.rank[i];
        }
        return 0;
    });
    return scored.map((s) => s.row);
}
function obviousMatch(q, list) {
    if (q.total == null || q.total <= 0)
        return null;
    const want = (0, reconcile_util_1.cents)(q.total);
    const exact = list.filter((r) => Math.abs((0, reconcile_util_1.cents)(r.amount)) === want && !r.attachedTotals.includes(want));
    if (exact.length !== 1)
        return null;
    const only = exact[0];
    if (!q.date || !only.date)
        return only;
    const a = dayNumber(q.date);
    const b = dayNumber(only.date);
    return a != null && b != null && Math.abs(a - b) <= 3 ? only : null;
}
//# sourceMappingURL=attachment-match.util.js.map