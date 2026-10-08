"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taxAmount = exports.fits = void 0;
exports.kindOf = kindOf;
exports.candidates = candidates;
exports.taxLines = taxLines;
exports.taxEntry = taxEntry;
exports.taxReportRows = taxReportRows;
exports.withTaxRows = withTaxRows;
const chart_of_accounts_1 = require("./chart-of-accounts");
const reconcile_util_1 = require("./reconcile.util");
const TYPE_OF = new Map(chart_of_accounts_1.CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));
function kindOf(offsetAccount) {
    const type = TYPE_OF.get(offsetAccount);
    if (type === 'INCOME')
        return 'SALES';
    if (type === 'EXPENSE')
        return 'PURCHASE';
    return null;
}
const fits = (agency, kind) => agency.type === 'BOTH' || agency.type === kind;
exports.fits = fits;
function candidates(rows, agencies) {
    return rows.flatMap((r) => {
        const kind = kindOf(r.offsetAccount);
        return kind && agencies.some((a) => (0, exports.fits)(a, kind)) ? [{ ...r, kind }] : [];
    });
}
const taxAmount = (amount, rate) => Math.round((Math.abs((0, reconcile_util_1.cents)(amount)) * rate) / 100) / 100;
exports.taxAmount = taxAmount;
function taxLines(rows, verdicts, agencies) {
    const rowOf = new Map(rows.map((r) => [r.id, r]));
    const agencyOf = new Map(agencies.map((a) => [a.id, a]));
    const seen = new Set();
    const out = [];
    for (const v of verdicts) {
        const row = rowOf.get(v.id);
        if (!row)
            continue;
        for (const agencyId of v.agencyIds) {
            const agency = agencyOf.get(agencyId);
            const key = `${row.id}:${agencyId}`;
            if (!agency || !(0, exports.fits)(agency, row.kind) || seen.has(key))
                continue;
            seen.add(key);
            const amount = (0, exports.taxAmount)(row.amount, agency.rate);
            if (amount === 0)
                continue;
            out.push({
                transactionId: row.id,
                agencyId,
                kind: row.kind,
                rate: agency.rate,
                amount,
            });
        }
    }
    return out;
}
function taxEntry(kind, offsetAccount, agency) {
    return kind === 'SALES'
        ? { debitAccount: offsetAccount, creditAccount: agency }
        : { debitAccount: agency, creditAccount: offsetAccount };
}
function taxReportRows(kind, offsetAccount, agency, amount) {
    const s = kind === 'SALES' ? 1 : -1;
    return [
        { amount: s * amount, offsetAccount: agency },
        { amount: -s * amount, offsetAccount: offsetAccount },
    ];
}
function withTaxRows(parents, childrenOf) {
    return parents.flatMap((p) => [p, ...(childrenOf(p) ?? [])]);
}
//# sourceMappingURL=tax.util.js.map