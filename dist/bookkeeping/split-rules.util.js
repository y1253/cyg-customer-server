"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ruleCategory = void 0;
exports.directionOf = directionOf;
exports.ruleSplits = ruleSplits;
exports.ratesLabel = ratesLabel;
const reconcile_util_1 = require("./reconcile.util");
const tax_util_1 = require("./tax.util");
function directionOf(amount) {
    if ((0, reconcile_util_1.cents)(amount) > 0)
        return 'SALES';
    if ((0, reconcile_util_1.cents)(amount) < 0)
        return 'PURCHASE';
    return null;
}
const ruleCategory = (rule) => rule.category?.trim() || rule.name;
exports.ruleCategory = ruleCategory;
function ruleSplits(amount, rules) {
    const kind = directionOf(amount);
    if (!kind)
        return [];
    let left = Math.abs((0, reconcile_util_1.cents)(amount));
    const out = [];
    const percent = [];
    for (const rule of rules) {
        const r = rule.rates.find((x) => x.kind === kind);
        if (!r)
            continue;
        if (r.mode === 'FIXED') {
            const take = Math.min(left, Math.max(0, (0, reconcile_util_1.cents)(r.amount ?? 0)));
            if (take <= 0)
                continue;
            left -= take;
            out.push({
                ruleId: rule.id,
                category: (0, exports.ruleCategory)(rule),
                amount: take / 100,
            });
        }
        else if (r.rate > 0) {
            percent.push({ rule, rate: r.rate });
        }
    }
    if (percent.length && left > 0) {
        const amounts = (0, tax_util_1.includedTaxes)(left / 100, percent.map((p) => p.rate));
        percent.forEach((p, i) => {
            if (amounts[i] > 0)
                out.push({
                    ruleId: p.rule.id,
                    category: (0, exports.ruleCategory)(p.rule),
                    amount: amounts[i],
                });
        });
    }
    return out;
}
function ratesLabel(rates) {
    return rates
        .map((r) => `${r.kind === 'SALES' ? 'In' : 'Out'} ${r.mode === 'FIXED' ? `$${(r.amount ?? 0).toFixed(2)}` : `${r.rate}%`}`)
        .join(' · ');
}
//# sourceMappingURL=split-rules.util.js.map