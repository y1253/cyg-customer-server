"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETAINED_EARNINGS = exports.OPENING_BALANCE_EQUITY = void 0;
exports.buildReports = buildReports;
const chart_of_accounts_1 = require("./chart-of-accounts");
exports.OPENING_BALANCE_EQUITY = 'Opening Balance Equity';
exports.RETAINED_EARNINGS = 'Retained Earnings';
const TYPE_OF = new Map(chart_of_accounts_1.CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));
const typeOf = (name) => TYPE_OF.get(name) ?? 'EXPENSE';
const CREDIT_NORMAL = new Set([
    'INCOME',
    'LIABILITY',
    'EQUITY',
]);
const cents = (n) => Math.round(n * 100);
const dollars = (c) => c / 100 + 0;
function tally(rows, from, to) {
    const offsets = new Map();
    const banks = new Map();
    const add = (m, key, c) => {
        const t = m.get(key) ?? { sum: 0, count: 0 };
        t.sum += c;
        t.count += 1;
        m.set(key, t);
    };
    for (const r of rows) {
        if ((from || to) && !r.date)
            continue;
        if (from && r.date < from)
            continue;
        if (to && r.date > to)
            continue;
        const c = cents(r.amount);
        add(offsets, r.offsetAccount, c);
        add(banks, r.bankAccount, c);
    }
    return { offsets, banks };
}
const normal = (type, sum) => CREDIT_NORMAL.has(type) ? sum : -sum;
function buildReports(rows, openings, from = null, to = null) {
    const bankNames = [
        ...new Set([
            ...openings.map((o) => o.bankAccount),
            ...rows.map((r) => r.bankAccount),
        ]),
    ].sort();
    const openingOf = new Map(openings.map((o) => [o.bankAccount, cents(o.amount)]));
    const period = tally(rows, from, to);
    const chartNames = chart_of_accounts_1.CHART_OF_ACCOUNTS.map((a) => a.name);
    const extra = [...period.offsets.keys()].filter((n) => !TYPE_OF.has(n));
    const accounts = [
        ...bankNames.map((name) => {
            const t = period.banks.get(name);
            return {
                name,
                type: 'ASSET',
                bank: true,
                balance: dollars(t?.sum ?? 0),
                count: t?.count ?? 0,
            };
        }),
        ...[...chartNames, ...extra].map((name) => {
            const type = typeOf(name);
            const t = period.offsets.get(name);
            return {
                name,
                type,
                bank: false,
                balance: dollars(normal(type, t?.sum ?? 0)),
                count: t?.count ?? 0,
            };
        }),
    ];
    const lines = (type) => accounts
        .filter((a) => !a.bank && a.type === type && a.count > 0)
        .map((a) => ({ name: a.name, amount: a.balance }));
    const total = (ls) => dollars(ls.reduce((s, l) => s + cents(l.amount), 0));
    const income = lines('INCOME');
    const expenses = lines('EXPENSE');
    const totalIncome = total(income);
    const totalExpenses = total(expenses);
    const all = tally(rows, null, to);
    const sheetLines = (type) => [...all.offsets.entries()]
        .filter(([name]) => typeOf(name) === type)
        .map(([name, t]) => ({ name, amount: dollars(normal(type, t.sum)) }))
        .sort((a, b) => chartNames.indexOf(a.name) - chartNames.indexOf(b.name));
    const netToDate = dollars([...all.offsets.entries()]
        .filter(([name]) => ['INCOME', 'EXPENSE'].includes(typeOf(name)))
        .reduce((s, [, t]) => s + t.sum, 0));
    const openingTotal = dollars([...openingOf.values()].reduce((s, c) => s + c, 0));
    const assets = [
        ...bankNames.map((name) => ({
            name,
            amount: dollars((openingOf.get(name) ?? 0) + (all.banks.get(name)?.sum ?? 0)),
        })),
        ...sheetLines('ASSET'),
    ];
    const liabilities = sheetLines('LIABILITY');
    const equity = [
        ...sheetLines('EQUITY'),
        ...(openingTotal !== 0
            ? [{ name: exports.OPENING_BALANCE_EQUITY, amount: openingTotal }]
            : []),
        { name: exports.RETAINED_EARNINGS, amount: netToDate },
    ];
    const totalAssets = total(assets);
    const totalLiabilities = total(liabilities);
    const totalEquity = total(equity);
    const totalLiabilitiesAndEquity = dollars(cents(totalLiabilities) + cents(totalEquity));
    const unc = period.offsets.get(chart_of_accounts_1.UNCATEGORIZED);
    return {
        from,
        to,
        accounts,
        incomeStatement: {
            income,
            totalIncome,
            expenses,
            totalExpenses,
            netIncome: dollars(cents(totalIncome) - cents(totalExpenses)),
        },
        balanceSheet: {
            asOf: to,
            assets,
            totalAssets,
            liabilities,
            totalLiabilities,
            equity,
            totalEquity,
            totalLiabilitiesAndEquity,
            balanced: cents(totalAssets) === cents(totalLiabilitiesAndEquity),
        },
        uncategorized: {
            count: unc?.count ?? 0,
            amount: dollars(-(unc?.sum ?? 0)),
        },
    };
}
//# sourceMappingURL=reports.util.js.map