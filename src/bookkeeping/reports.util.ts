import {
  CHART_OF_ACCOUNTS,
  UNCATEGORIZED,
  type AccountType,
} from './chart-of-accounts';

/** One ledger row, as the reports need it. */
export interface ReportRow {
  /** Signed from the bank's side: > 0 money in, < 0 money out. */
  amount: number;
  offsetAccount: string;
  /** The bank side of the entry, e.g. "Chase 4362"; null on a tax line (no cash moves). */
  bankAccount: string | null;
  /** YYYY-MM-DD the row counts on; null when the statement printed no date. */
  date: string | null;
}

export interface AccountBalance {
  name: string;
  type: AccountType;
  /** True for a bank / card account itself (the cash side of every entry). */
  bank: boolean;
  /** On the account's normal side: an expense of $50 is +50, a refund lowers it. */
  balance: number;
  /** Ledger rows posted to it in the period. */
  count: number;
}

export interface ReportLine {
  name: string;
  amount: number;
}

export interface ReportsView {
  from: string | null;
  to: string | null;
  /** Every chart account plus each bank account, for `from…to`. */
  accounts: AccountBalance[];
  incomeStatement: {
    income: ReportLine[];
    totalIncome: number;
    expenses: ReportLine[];
    totalExpenses: number;
    netIncome: number;
  };
  /** Everything up to `to` — a balance sheet has no start date. */
  balanceSheet: {
    asOf: string | null;
    assets: ReportLine[];
    totalAssets: number;
    liabilities: ReportLine[];
    totalLiabilities: number;
    equity: ReportLine[];
    totalEquity: number;
    totalLiabilitiesAndEquity: number;
    balanced: boolean;
  };
  /** Rows the AI could not place, so the customer knows the reports are incomplete. */
  uncategorized: { count: number; amount: number };
}

export const RETAINED_EARNINGS = 'Retained Earnings';

const TYPE_OF = new Map(CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));
/** An account no longer in the chart (renamed) still has to land somewhere. */
const chartType = (name: string): AccountType => TYPE_OF.get(name) ?? 'EXPENSE';

/** Credit-normal accounts grow with money IN; debit-normal ones with money OUT. */
const CREDIT_NORMAL: ReadonlySet<AccountType> = new Set([
  'INCOME',
  'LIABILITY',
  'EQUITY',
]);

const cents = (n: number): number => Math.round(n * 100);
/** `+ 0` turns -0 (from negating an empty sum) into 0, so it never prints "-$0.00". */
const dollars = (c: number): number => c / 100 + 0;

interface Tally {
  /** Σ amount in cents, bank's sign. */
  sum: number;
  count: number;
}

/**
 * Totals per offset account and per bank account, in cents. A row with no date counts
 * only when there is no bound to test it against.
 */
function tally(rows: ReportRow[], from: string | null, to: string | null) {
  const offsets = new Map<string, Tally>();
  const banks = new Map<string, Tally>();
  const add = (m: Map<string, Tally>, key: string, c: number) => {
    const t = m.get(key) ?? { sum: 0, count: 0 };
    t.sum += c;
    t.count += 1;
    m.set(key, t);
  };
  for (const r of rows) {
    if ((from || to) && !r.date) continue;
    if (from && r.date! < from) continue;
    if (to && r.date! > to) continue;
    const c = cents(r.amount);
    add(offsets, r.offsetAccount, c);
    if (r.bankAccount !== null) add(banks, r.bankAccount, c);
  }
  return { offsets, banks };
}

/** The offset account's balance on its normal side, in cents. */
const normal = (type: AccountType, sum: number): number =>
  CREDIT_NORMAL.has(type) ? sum : -sum;

/**
 * Chart of accounts, income statement and balance sheet from the ledger.
 *
 * Every row is a double entry between a bank account (an asset) and its offset account,
 * so the balance sheet balances by construction: cash = Σ amount, and every Σ amount
 * lands on the other side in an income, expense, asset, liability or equity account.
 * The bank's printed starting balances arrive as rows too ("Starting balance" →
 * Owner's Loan, `opening-balance.util.ts`), and net income to date is Retained Earnings.
 */
export function buildReports(
  rows: ReportRow[],
  from: string | null = null,
  to: string | null = null,
  /** Tax agencies: LIABILITY accounts outside the chart. */
  liabilityAccounts: string[] = [],
): ReportsView {
  const bankNames = [
    ...new Set(
      rows.map((r) => r.bankAccount).filter((b): b is string => b !== null),
    ),
  ].sort();
  const liabilitySet = new Set(liabilityAccounts);
  const typeOf = (name: string): AccountType =>
    liabilitySet.has(name) ? 'LIABILITY' : chartType(name);

  // ---- chart of accounts + income statement: the period ----
  const period = tally(rows, from, to);
  const chartNames = CHART_OF_ACCOUNTS.map((a) => a.name);
  const extra = [...period.offsets.keys()].filter((n) => !TYPE_OF.has(n));
  const accounts: AccountBalance[] = [
    ...bankNames.map((name) => {
      const t = period.banks.get(name);
      return {
        name,
        type: 'ASSET' as const,
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

  const lines = (type: AccountType): ReportLine[] =>
    accounts
      .filter((a) => !a.bank && a.type === type && a.count > 0)
      .map((a) => ({ name: a.name, amount: a.balance }));
  const total = (ls: ReportLine[]): number =>
    dollars(ls.reduce((s, l) => s + cents(l.amount), 0));

  const income = lines('INCOME');
  const expenses = lines('EXPENSE');
  const totalIncome = total(income);
  const totalExpenses = total(expenses);

  // ---- balance sheet: everything up to `to` ----
  const all = tally(rows, null, to);
  const sheetLines = (type: AccountType): ReportLine[] =>
    [...all.offsets.entries()]
      .filter(([name]) => typeOf(name) === type)
      .map(([name, t]) => ({ name, amount: dollars(normal(type, t.sum)) }))
      .sort((a, b) => chartNames.indexOf(a.name) - chartNames.indexOf(b.name));
  const netToDate = dollars(
    [...all.offsets.entries()]
      .filter(([name]) => ['INCOME', 'EXPENSE'].includes(typeOf(name)))
      .reduce((s, [, t]) => s + t.sum, 0),
  );

  const assets: ReportLine[] = [
    ...bankNames.map((name) => ({
      name,
      amount: dollars(all.banks.get(name)?.sum ?? 0),
    })),
    ...sheetLines('ASSET'),
  ];
  const liabilities = sheetLines('LIABILITY');
  const equity: ReportLine[] = [
    ...sheetLines('EQUITY'),
    { name: RETAINED_EARNINGS, amount: netToDate },
  ];
  const totalAssets = total(assets);
  const totalLiabilities = total(liabilities);
  const totalEquity = total(equity);
  const totalLiabilitiesAndEquity = dollars(
    cents(totalLiabilities) + cents(totalEquity),
  );

  const unc = period.offsets.get(UNCATEGORIZED);
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
