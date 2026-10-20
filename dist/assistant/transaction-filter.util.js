"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_ROWS = void 0;
exports.filterTransactions = filterTransactions;
exports.MAX_ROWS = 200;
const dayOf = (iso) => (iso ? iso.slice(0, 10) : null);
const has = (hay, needle) => !!hay && hay.toLowerCase().includes(needle);
function filterTransactions(rows, q) {
    const name = q.name?.trim().toLowerCase();
    const category = q.category?.trim().toLowerCase();
    const text = q.text?.trim().toLowerCase();
    const matches = rows.filter((r) => {
        if (r.kind && r.kind !== 'split')
            return false;
        const date = dayOf(r.postingDate ?? r.pendingDate);
        if (q.from && (!date || date < q.from))
            return false;
        if (q.to && (!date || date > q.to))
            return false;
        if (name && !has(r.name, name))
            return false;
        if (category && !has(r.offsetAccount, category))
            return false;
        if (text &&
            !has(r.name, text) &&
            !has(r.description, text) &&
            !has(r.itemName, text)) {
            return false;
        }
        const abs = Math.abs(r.amount);
        if (q.minAmount != null && abs < q.minAmount)
            return false;
        if (q.maxAmount != null && abs > q.maxAmount)
            return false;
        if (q.direction === 'in' && r.amount < 0)
            return false;
        if (q.direction === 'out' && r.amount >= 0)
            return false;
        return true;
    });
    const sorted = [...matches].sort((a, b) => (dayOf(b.postingDate ?? b.pendingDate) ?? '').localeCompare(dayOf(a.postingDate ?? a.pendingDate) ?? ''));
    const limit = Math.min(Math.max(q.limit ?? 50, 1), exports.MAX_ROWS);
    const total = Math.round(matches.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    return {
        count: matches.length,
        total,
        rows: sorted.slice(0, limit).map((r) => ({
            id: r.id,
            split: r.kind === 'split',
            date: dayOf(r.postingDate ?? r.pendingDate),
            name: r.itemName ?? r.name,
            description: r.description,
            amount: r.amount,
            category: r.offsetAccount,
            statement: r.statementLabel,
            attachments: r.attachments?.length ?? 0,
        })),
    };
}
//# sourceMappingURL=transaction-filter.util.js.map