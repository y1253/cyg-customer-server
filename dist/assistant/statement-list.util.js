"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOT_SORTED = exports.MAX_STATEMENT_LIMIT = exports.DEFAULT_STATEMENT_LIMIT = void 0;
exports.listStatements = listStatements;
exports.DEFAULT_STATEMENT_LIMIT = 40;
exports.MAX_STATEMENT_LIMIT = 100;
exports.NOT_SORTED = 'Not sorted yet';
const day = (iso) => (iso ? iso.slice(0, 10) : null);
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const ALIASES = { amex: 'american express' };
function accountMatches(accountName, query) {
    const name = norm(accountName ?? exports.NOT_SORTED);
    return norm(query)
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => ALIASES[w] ?? w)
        .every((w) => name.includes(w));
}
function overlaps(r, from, to) {
    const start = day(r.periodStart) ?? day(r.periodEnd);
    const end = day(r.periodEnd) ?? day(r.periodStart);
    if (!start || !end)
        return true;
    if (from && end < from)
        return false;
    if (to && start > to)
        return false;
    return true;
}
function listStatements(rows, q = {}) {
    const byAccount = new Map();
    for (const r of rows) {
        const account = r.accountName ?? exports.NOT_SORTED;
        const a = byAccount.get(account) ?? {
            account,
            statements: 0,
            latestPeriodEnd: null,
            notDone: 0,
        };
        a.statements += 1;
        const end = day(r.periodEnd);
        if (end && (!a.latestPeriodEnd || end > a.latestPeriodEnd))
            a.latestPeriodEnd = end;
        if (r.status !== 'DONE')
            a.notDone += 1;
        byAccount.set(account, a);
    }
    const status = q.status?.trim().toUpperCase() || null;
    const matched = rows
        .filter((r) => !q.account?.trim() || accountMatches(r.accountName, q.account))
        .filter((r) => !status || r.status === status)
        .filter((r) => overlaps(r, q.from ?? null, q.to ?? null))
        .sort((a, b) => {
        const ka = day(a.periodEnd) ?? '9999';
        const kb = day(b.periodEnd) ?? '9999';
        return kb.localeCompare(ka) || b.id - a.id;
    });
    const limit = Math.min(Math.max(1, Math.floor(q.limit ?? exports.DEFAULT_STATEMENT_LIMIT)), exports.MAX_STATEMENT_LIMIT);
    return {
        total: rows.length,
        accounts: [...byAccount.values()].sort((a, b) => a.account.localeCompare(b.account)),
        matched: matched.length,
        ...(matched.length > limit && {
            note: `Showing ${limit} of ${matched.length} — filter by account, period or status to see the rest.`,
        }),
        statements: matched.slice(0, limit).map((r) => ({
            id: r.id,
            label: r.label,
            status: r.status,
            account: r.accountName,
            periodStart: day(r.periodStart),
            periodEnd: day(r.periodEnd),
            transactions: r.transactionCount,
            ...(r.error && { error: r.error }),
        })),
    };
}
//# sourceMappingURL=statement-list.util.js.map