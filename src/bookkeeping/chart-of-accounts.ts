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
/** The offset of every revaluation row of a foreign-currency account (`fx.util.ts`). */
export const FX_GAIN_LOSS = 'Exchange Gain or Loss';

export const CHART_OF_ACCOUNTS: readonly ChartAccount[] = [
  // Income
  { name: 'Sales Income', type: 'INCOME' },
  { name: 'Service Income', type: 'INCOME' },
  { name: 'Interest Income', type: 'INCOME' },
  { name: 'Other Income', type: 'INCOME' },
  // A gain is income, a loss lowers it (negative).
  { name: FX_GAIN_LOSS, type: 'INCOME' },
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

const CHART_TYPE = new Map(CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));

/** What decides an account's type, for one customer. */
export interface TypeContext {
  /** The customer moved this account to another section (`CustomerAccountType`). */
  overrides?: ReadonlyMap<string, AccountType>;
  /** Tax agencies — LIABILITY accounts outside the chart. */
  liabilities?: ReadonlySet<string>;
  /** The customer's OWN categories (`CustomerAccount`) and the type they picked. */
  custom?: ReadonlyMap<string, AccountType>;
}

/**
 * THE type of an account for a customer, everywhere (reports, tax kind, Names tab): their
 * own move first, then a tax agency (liability), their own category, the chart — and an
 * account no longer in the chart (renamed) lands in expenses.
 */
export function typeFor(name: string, ctx: TypeContext = {}): AccountType {
  return (
    ctx.overrides?.get(name) ??
    (ctx.liabilities?.has(name) ? 'LIABILITY' : undefined) ??
    ctx.custom?.get(name) ??
    CHART_TYPE.get(name) ??
    'EXPENSE'
  );
}

export const ACCOUNT_NAMES: readonly string[] = CHART_OF_ACCOUNTS.map(
  (a) => a.name,
);

/**
 * The chart name — or one of the customer's OWN accounts (`extra`, `CustomerAccount`) —
 * or Uncategorized for anything else. Case-insensitive; returns the stored spelling.
 */
export function normalizeAccount(
  name: unknown,
  extra?: Iterable<string>,
): string {
  if (typeof name !== 'string') return UNCATEGORIZED;
  const wanted = name.trim().toLowerCase();
  const hit = ACCOUNT_NAMES.find((n) => n.toLowerCase() === wanted);
  if (hit) return hit;
  for (const n of extra ?? []) if (n.toLowerCase() === wanted) return n;
  return UNCATEGORIZED;
}
