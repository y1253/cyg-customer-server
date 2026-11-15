"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diffErrors = diffErrors;
exports.orderErrors = orderErrors;
const statement_problem_util_1 = require("./statement-problem.util");
function diffErrors(open, found) {
    const plan = { create: [], update: [], resolve: [] };
    const byKey = new Map();
    for (const e of open) {
        if (e.source === 'AI')
            continue;
        const key = `${e.statementId}:${e.kind}`;
        if (byKey.has(key))
            plan.resolve.push(e.id);
        else
            byKey.set(key, e);
    }
    const kept = new Set();
    for (const [statementId, problems] of found) {
        for (const p of problems) {
            const key = `${statementId}:${p.kind}`;
            if (kept.has(key))
                continue;
            kept.add(key);
            const row = byKey.get(key);
            if (!row)
                plan.create.push({ ...p, statementId });
            else if (row.title !== p.title || row.text !== p.text)
                plan.update.push({ ...p, id: row.id });
        }
    }
    for (const [key, row] of byKey)
        if (!kept.has(key))
            plan.resolve.push(row.id);
    return plan;
}
function orderErrors(list) {
    const rank = (k) => {
        const i = statement_problem_util_1.PROBLEM_ORDER.indexOf(k);
        return i === -1 ? statement_problem_util_1.PROBLEM_ORDER.length : i;
    };
    return [...list].sort((a, b) => rank(a.kind) - rank(b.kind) || a.id - b.id);
}
//# sourceMappingURL=statement-errors.util.js.map