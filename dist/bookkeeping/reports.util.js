"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RETAINED_EARNINGS = exports.UNCLARIFIED_NAME = void 0;
exports.buildReports = buildReports;
const chart_of_accounts_1 = require("./chart-of-accounts");
exports.UNCLARIFIED_NAME = 'Unclarified name';
exports.RETAINED_EARNINGS = 'Retained Earnings';
const TYPE_OF = new Map(chart_of_accounts_1.CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));
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
    const names = new Map();
    const add = (m, key, c, f = 0) => {
        const t = m.get(key) ?? { sum: 0, count: 0, foreign: 0 };
        t.sum += c;
        t.count += 1;
        t.foreign += f;
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
        if (r.bankAccount !== null) {
            add(banks, r.bankAccount, c, r.foreign === undefined ? 0 : cents(r.foreign));
        }
        const per = names.get(r.offsetAccount) ?? new Map();
        const who = r.name?.trim() || exports.UNCLARIFIED_NAME;
        per.set(who, (per.get(who) ?? 0) + c);
        names.set(r.offsetAccount, per);
    }
    return { offsets, banks, names };
}
const normal = (type, sum) => CREDIT_NORMAL.has(type) ? sum : -sum;
const bankNormal = (type, sum) => -normal(type, sum);
const BALANCE_SHEET = new Set([
    'ASSET',
    'LIABILITY',
    'EQUITY',
]);
function buildReports(rows, from = null, to = null, options = {}) {
    const customTypes = options.customTypes ?? new Map();
    const overrides = options.overrides ?? new Map();
    const bankNames = [
        ...new Set(rows.map((r) => r.bankAccount).filter((b) => b !== null)),
    ].sort();
    const ctx = {
        overrides,
        liabilities: new Set(options.liabilityAccounts ?? []),
        custom: customTypes,
    };
    const typeOf = (name) => (0, chart_of_accounts_1.typeFor)(name, ctx);
    const inCurrency = (name, type, t) => {
        const c = options.bankCurrencies?.get(name);
        if (!c)
            return {};
        return c.foreign
            ? {
                currency: c.currency,
                foreign: dollars(bankNormal(type, t?.foreign ?? 0)),
            }
            : { currency: c.currency };
    };
    const bankType = (name) => {
        const moved = overrides.get(name);
        if (moved && BALANCE_SHEET.has(moved))
            return moved;
        return options.creditCards?.has(name) ? 'LIABILITY' : 'ASSET';
    };
    const period = tally(rows, from, to);
    const chartNames = chart_of_accounts_1.CHART_OF_ACCOUNTS.map((a) => a.name);
    const own = [...customTypes.keys()].filter((n) => !TYPE_OF.has(n));
    const extra = [
        ...own,
        ...[...period.offsets.keys()].filter((n) => !TYPE_OF.has(n) && !customTypes.has(n)),
    ];
    const accounts = [
        ...bankNames.map((name) => {
            const t = period.banks.get(name);
            const type = bankType(name);
            const { currency, foreign } = inCurrency(name, type, t);
            return {
                name,
                type,
                bank: true,
                balance: dollars(bankNormal(type, t?.sum ?? 0)),
                count: t?.count ?? 0,
                ...(currency && { currency }),
                ...(foreign !== undefined && { foreignBalance: foreign }),
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
    const byName = (account, type) => [...(period.names.get(account) ?? new Map())]
        .map(([name, sum]) => ({ name, amount: dollars(normal(type, sum)) }))
        .filter((l) => l.amount !== 0)
        .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
    const lines = (type) => accounts
        .filter((a) => !a.bank && a.type === type && a.count > 0)
        .map((a) => ({
        name: a.name,
        amount: a.balance,
        byName: byName(a.name, type),
    }));
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
    const banksIn = (type) => bankNames
        .filter((name) => bankType(name) === type)
        .map((name) => {
        const t = all.banks.get(name);
        const { currency, foreign } = inCurrency(name, type, t);
        return {
            name,
            bank: true,
            amount: dollars(bankNormal(type, t?.sum ?? 0)),
            ...(foreign !== undefined && { currency, foreignAmount: foreign }),
        };
    });
    const assets = [...banksIn('ASSET'), ...sheetLines('ASSET')];
    const liabilities = [...banksIn('LIABILITY'), ...sheetLines('LIABILITY')];
    const equity = [
        ...banksIn('EQUITY'),
        ...sheetLines('EQUITY'),
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
        moved: [...overrides.keys()],
    };
}
//# sourceMappingURL=reports.util.js.map