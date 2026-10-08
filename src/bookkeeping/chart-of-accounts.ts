/**
 * The FIXED chart the AI chooses offset accounts from. It is passed to OpenAI as a JSON
 * schema `enum`, so a reply naming anything else is rejected by the model's own
 * structured output — the same vendor always lands in the same account, and totals add up.
 *
 * Adding an account is a one-line change here; renaming one leaves old rows holding the
 * old name (the ledger stores the string), so prefer adding.
 */
export type AccountType =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'INCOME'
  | 'EXPENSE';

export interface ChartAccount {
  name: string;
  type: AccountType;
}

export const UNCATEGORIZED = 'Uncategorized';
/** The offset of every statement's "Starting balance" row (`opening-balance.util.ts`). */
export const OWNERS_LOAN = "Owner's Loan";

export const CHART_OF_ACCOUNTS: readonly ChartAccount[] = [
  // Income
  { name: 'Sales Income', type: 'INCOME' },
  { name: 'Service Income', type: 'INCOME' },
  { name: 'Interest Income', type: 'INCOME' },
  { name: 'Other Income', type: 'INCOME' },
  // Expenses
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
  // Balance sheet
  { name: 'Transfer Between Accounts', type: 'ASSET' },
  { name: 'Credit Card Payment', type: 'LIABILITY' },
  { name: 'Loan Payment', type: 'LIABILITY' },
  { name: 'Sales Tax Payable', type: 'LIABILITY' },
  { name: OWNERS_LOAN, type: 'LIABILITY' },
  { name: 'Owner Contribution', type: 'EQUITY' },
  { name: 'Owner Draw', type: 'EQUITY' },
  { name: UNCATEGORIZED, type: 'EXPENSE' },
];

export const ACCOUNT_NAMES: readonly string[] = CHART_OF_ACCOUNTS.map(
  (a) => a.name,
);

/** The chart name, or Uncategorized for anything the chart does not contain. */
export function normalizeAccount(name: unknown): string {
  if (typeof name !== 'string') return UNCATEGORIZED;
  const hit = ACCOUNT_NAMES.find(
    (n) => n.toLowerCase() === name.trim().toLowerCase(),
  );
  return hit ?? UNCATEGORIZED;
}
