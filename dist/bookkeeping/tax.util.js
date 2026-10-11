"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taxAmount = exports.fits = exports.rateFor = exports.TYPE_OF = void 0;
exports.kindOf = kindOf;
exports.candidates = candidates;
exports.taxLines = taxLines;
exports.taxSplit = taxSplit;
const chart_of_accounts_1 = require("./chart-of-accounts");
const reconcile_util_1 = require("./reconcile.util");
exports.TYPE_OF = new Map(chart_of_accounts_1.CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));
function kindOf(offsetAccount) {
    const type = exports.TYPE_OF.get(offsetAccount);
    if (type === 'INCOME')
        return 'SALES';
    if (type === 'EXPENSE')
        return 'PURCHASE';
    return null;
}
const rateFor = (agency, kind) => agency.rates[kind];
exports.rateFor = rateFor;
const fits = (agency, kind) => (0, exports.rateFor)(agency, kind) !== undefined;
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
            const rate = (0, exports.rateFor)(agency, row.kind);
            const amount = (0, exports.taxAmount)(row.amount, rate);
            if (amount === 0)
                continue;
            out.push({
                transactionId: row.id,
                agencyId,
                kind: row.kind,
                rate,
                amount,
            });
        }
    }
    return out;
}
function taxSplit(parent, lines) {
    const sign = parent.amount < 0 ? -1 : 1;
    const swap = (account, agency) => account === parent.offsetAccount ? agency : account;
    const taxes = lines.map((t) => ({
        amount: sign * t.amount,
        offsetAccount: t.agency,
        debitAccount: swap(parent.debitAccount, t.agency),
        creditAccount: swap(parent.creditAccount, t.agency),
    }));
    return { parent, taxes };
}
//# sourceMappingURL=tax.util.js.map