"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_NAMES = exports.CHART_OF_ACCOUNTS = exports.FX_GAIN_LOSS = exports.OWNERS_LOAN = exports.UNCATEGORIZED = void 0;
exports.typeFor = typeFor;
exports.normalizeAccount = normalizeAccount;
exports.UNCATEGORIZED = 'Uncategorized';
exports.OWNERS_LOAN = "Owner's Loan";
exports.FX_GAIN_LOSS = 'Exchange Gain or Loss';
exports.CHART_OF_ACCOUNTS = [
    { name: 'Sales Income', type: 'INCOME' },
    { name: 'Service Income', type: 'INCOME' },
    { name: 'Interest Income', type: 'INCOME' },
    { name: 'Other Income', type: 'INCOME' },
    { name: exports.FX_GAIN_LOSS, type: 'INCOME' },
    { name: 'Office Expense', type: 'EXPENSE' },
    { name: 'Advertising & Marketing', type: 'EXPENSE' },
    { name: 'Bank Fees', type: 'EXPENSE' },
    { name: 'Meals & Entertainment', type: 'EXPENSE' },
    { name: 'Travel', type: 'EXPENSE' },
    { name: 'Vehicle & Fuel', type: 'EXPENSE' },
    { name: 'Rent', type: 'EXPENSE' },
    { name: 'Utilities', type: 'EXPENSE' },
    { name: 'Telephone & Internet', type: 'EXPENSE' },
    { name: 'Software & Subscriptions', type: 'EXPENSE' },
    { name: 'Professional Fees', type: 'EXPENSE' },
    { name: 'Insurance', type: 'EXPENSE' },
    { name: 'Payroll & Wages', type: 'EXPENSE' },
    { name: 'Contractors', type: 'EXPENSE' },
    { name: 'Cost of Goods Sold', type: 'EXPENSE' },
    { name: 'Repairs & Maintenance', type: 'EXPENSE' },
    { name: 'Shipping & Postage', type: 'EXPENSE' },
    { name: 'Taxes & Licenses', type: 'EXPENSE' },
    { name: 'Supplies', type: 'EXPENSE' },
    { name: 'Other Expense', type: 'EXPENSE' },
    { name: 'Transfer Between Accounts', type: 'ASSET' },
    { name: 'Credit Card Payment', type: 'LIABILITY' },
    { name: 'Loan Payment', type: 'LIABILITY' },
    { name: 'Sales Tax Payable', type: 'LIABILITY' },
    { name: exports.OWNERS_LOAN, type: 'LIABILITY' },
    { name: 'Owner Contribution', type: 'EQUITY' },
    { name: 'Owner Draw', type: 'EQUITY' },
    { name: exports.UNCATEGORIZED, type: 'EXPENSE' },
];
const CHART_TYPE = new Map(exports.CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));
function typeFor(name, ctx = {}) {
    return (ctx.overrides?.get(name) ??
        (ctx.liabilities?.has(name) ? 'LIABILITY' : undefined) ??
        ctx.custom?.get(name) ??
        CHART_TYPE.get(name) ??
        'EXPENSE');
}
exports.ACCOUNT_NAMES = exports.CHART_OF_ACCOUNTS.map((a) => a.name);
function normalizeAccount(name, extra) {
    if (typeof name !== 'string')
        return exports.UNCATEGORIZED;
    const wanted = name.trim().toLowerCase();
    const hit = exports.ACCOUNT_NAMES.find((n) => n.toLowerCase() === wanted);
    if (hit)
        return hit;
    for (const n of extra ?? [])
        if (n.toLowerCase() === wanted)
            return n;
    return exports.UNCATEGORIZED;
}
//# sourceMappingURL=chart-of-accounts.js.map