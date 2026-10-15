"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nameTaxKey = exports.taxAmount = exports.fits = exports.rateFor = exports.TYPE_OF = void 0;
exports.kindOf = kindOf;
exports.includedTaxes = includedTaxes;
exports.taxSplit = taxSplit;
exports.nameTaxLines = nameTaxLines;
const chart_of_accounts_1 = require("./chart-of-accounts");
const reconcile_util_1 = require("./reconcile.util");
const reports_util_1 = require("./reports.util");
exports.TYPE_OF = new Map(chart_of_accounts_1.CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));
function kindOf(offsetAccount, ctx = {}) {
    const type = (0, chart_of_accounts_1.typeFor)(offsetAccount, ctx);
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
const nameTaxKey = (name) => (name?.trim() || reports_util_1.UNCLARIFIED_NAME).toLowerCase();
exports.nameTaxKey = nameTaxKey;
function nameTaxLines(rows, agenciesOf, agencies, ctx = {}) {
    const out = new Map();
    if (!agenciesOf.size || !agencies.length)
        return out;
    for (const r of rows) {
        if ((0, reconcile_util_1.cents)(r.amount) === 0)
            continue;
        const picked = agenciesOf.get((0, exports.nameTaxKey)(r.name));
        if (!picked?.length)
            continue;
        const kind = kindOf(r.offsetAccount, ctx);
        if (!kind)
            continue;
        const lines = agencies
            .filter((a) => picked.includes(a.id) && (0, exports.fits)(a, kind))
            .map((a) => ({
            agencyId: a.id,
            agency: a.name,
            kind,
            rate: (0, exports.rateFor)(a, kind),
        }));
        if (lines.length)
            out.set(r.id, lines);
    }
    return out;
}
//# sourceMappingURL=tax.util.js.map