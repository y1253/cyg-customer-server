"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taxAmount = exports.fits = exports.rateFor = exports.TYPE_OF = void 0;
exports.kindOf = kindOf;
exports.candidates = candidates;
exports.includedTaxes = includedTaxes;
exports.taxLines = taxLines;
exports.taxSplit = taxSplit;
const chart_of_accounts_1 = require("./chart-of-accounts");
const reconcile_util_1 = require("./reconcile.util");
exports.TYPE_OF = new Map(chart_of_accounts_1.CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));
function kindOf(offsetAccount, customTypes) {
    const type = exports.TYPE_OF.get(offsetAccount) ?? customTypes?.get(offsetAccount);
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
function candidates(rows, agencies, customTypes) {
    return rows.flatMap((r) => {
        const kind = kindOf(r.offsetAccount, customTypes);
        return kind && agencies.some((a) => (0, exports.fits)(a, kind)) ? [{ ...r, kind }] : [];
    });
}
function includedTaxes(amount, rates) {
    const total = rates.reduce((n, r) => n + r, 0);
    if (!rates.length || total <= 0)
        return rates.map(() => 0);
    const base = Math.abs((0, reconcile_util_1.cents)(amount));
    const allTax = Math.round((base * total) / (100 + total));
    const out = rates.map((r) => Math.round((base * r) / (100 + total)));
    const drift = allTax - out.reduce((n, c) => n + c, 0);
    out[out.length - 1] += drift;
    return out.map((c) => c / 100);
}
const taxAmount = (amount, rate) => includedTaxes(amount, [rate])[0];
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
        const picked = [];
        for (const agencyId of v.agencyIds) {
            const agency = agencyOf.get(agencyId);
            const key = `${row.id}:${agencyId}`;
            if (!agency || !(0, exports.fits)(agency, row.kind) || seen.has(key))
                continue;
            seen.add(key);
            picked.push({ agencyId, rate: (0, exports.rateFor)(agency, row.kind) });
        }
        const amounts = includedTaxes(row.amount, picked.map((p) => p.rate));
        picked.forEach((p, i) => {
            if (amounts[i] === 0)
                return;
            out.push({
                transactionId: row.id,
                agencyId: p.agencyId,
                kind: row.kind,
                rate: p.rate,
                amount: amounts[i],
            });
        });
    }
    return out;
}
function taxSplit(parent, lines) {
    if (!lines.length)
        return { parent, taxes: [] };
    const sign = parent.amount < 0 ? -1 : 1;
    const swap = (account, agency) => account === parent.offsetAccount ? agency : account;
    const amounts = includedTaxes(parent.amount, lines.map((t) => t.rate));
    const taxes = lines.map((t, i) => ({
        amount: sign * amounts[i],
        offsetAccount: t.agency,
        debitAccount: swap(parent.debitAccount, t.agency),
        creditAccount: swap(parent.creditAccount, t.agency),
    }));
    const taxCents = amounts.reduce((n, a) => n + Math.round(a * 100), 0);
    const net = ((0, reconcile_util_1.cents)(parent.amount) - sign * taxCents) / 100;
    return { parent: { ...parent, amount: net }, taxes };
}
//# sourceMappingURL=tax.util.js.map