"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toHome = exports.isFxCurrency = exports.FX_CURRENCIES = exports.FX_GAIN_LOSS = void 0;
exports.cadPerOn = cadPerOn;
exports.rateOn = rateOn;
exports.revaluationRows = revaluationRows;
const chart_of_accounts_1 = require("./chart-of-accounts");
Object.defineProperty(exports, "FX_GAIN_LOSS", { enumerable: true, get: function () { return chart_of_accounts_1.FX_GAIN_LOSS; } });
const ledger_util_1 = require("./ledger.util");
const reconcile_util_1 = require("./reconcile.util");
exports.FX_CURRENCIES = [
    'CAD',
    'USD',
    'EUR',
    'GBP',
    'AUD',
    'BRL',
    'CHF',
    'CNY',
    'HKD',
    'IDR',
    'INR',
    'JPY',
    'KRW',
    'MXN',
    'MYR',
    'NOK',
    'NZD',
    'PEN',
    'SAR',
    'SEK',
    'SGD',
    'THB',
    'TRY',
    'TWD',
    'VND',
    'ZAR',
];
const isFxCurrency = (c) => !!c && exports.FX_CURRENCIES.includes(c);
exports.isFxCurrency = isFxCurrency;
function cadPerOn(currency, date, series) {
    if (currency === 'CAD')
        return 1;
    if (!series?.length)
        return null;
    let lo = 0;
    let hi = series.length - 1;
    let hit = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (series[mid].date <= date) {
            hit = mid;
            lo = mid + 1;
        }
        else
            hi = mid - 1;
    }
    return hit >= 0 ? series[hit].cadPer : null;
}
function rateOn(from, home, date, seriesOf) {
    if (from === home)
        return 1;
    const a = cadPerOn(from, date, seriesOf(from));
    const b = cadPerOn(home, date, seriesOf(home));
    if (a === null || b === null || b === 0)
        return null;
    return a / b;
}
const toHome = (amount, rate) => Math.round((0, reconcile_util_1.cents)(amount) * rate) / 100 + 0;
exports.toHome = toHome;
function revaluationRows(statements) {
    const byAccount = new Map();
    for (const s of statements) {
        byAccount.set(s.bankAccount, [...(byAccount.get(s.bankAccount) ?? []), s]);
    }
    const out = [];
    for (const [bankAccount, list] of byAccount) {
        list.sort((a, b) => (a.periodEnd ?? '').localeCompare(b.periodEnd ?? '') ||
            a.statementId - b.statementId);
        let foreign = 0;
        let home = 0;
        for (const s of list) {
            foreign += (0, reconcile_util_1.cents)(s.foreign);
            home += (0, reconcile_util_1.cents)(s.home);
            if (!s.periodEnd || s.closingRate === null)
                continue;
            const target = Math.round(foreign * s.closingRate);
            const diff = target - home;
            if (diff === 0)
                continue;
            home += diff;
            const homeAmount = diff / 100;
            out.push({
                statementId: s.statementId,
                bankAccount,
                date: s.periodEnd,
                amount: 0,
                homeAmount,
                rate: s.closingRate,
                offsetAccount: chart_of_accounts_1.FX_GAIN_LOSS,
                ...(0, ledger_util_1.doubleEntry)(homeAmount, bankAccount, chart_of_accounts_1.FX_GAIN_LOSS),
            });
        }
    }
    return out;
}
//# sourceMappingURL=fx.util.js.map