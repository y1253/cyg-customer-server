"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_NAMES = exports.CHART_OF_ACCOUNTS = exports.OWNERS_LOAN = exports.UNCATEGORIZED = void 0;
exports.normalizeAccount = normalizeAccount;
exports.UNCATEGORIZED = 'Uncategorized';
exports.OWNERS_LOAN = "Owner's Loan";
exports.CHART_OF_ACCOUNTS = [
    { name: 'Sales Income', type: 'INCOME' },
    { name: 'Service Income', type: 'INCOME' },
    { name: 'Interest Income', type: 'INCOME' },
    { name: 'Other Income', type: 'INCOME' },
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
exports.ACCOUNT_NAMES = exports.CHART_OF_ACCOUNTS.map((a) => a.name);
function normalizeAccount(name) {
    if (typeof name !== 'string')
        return exports.UNCATEGORIZED;
    const hit = exports.ACCOUNT_NAMES.find((n) => n.toLowerCase() === name.trim().toLowerCase());
    return hit ?? exports.UNCATEGORIZED;
}
//# sourceMappingURL=chart-of-accounts.js.map