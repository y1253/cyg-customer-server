import {
  CHART_OF_ACCOUNTS,
  typeFor,
  UNCATEGORIZED,
  type AccountType,
} from './chart-of-accounts';

/** How a row with no payee is listed by name (never stored — the DB keeps null). */
export const UNCLARIFIED_NAME = 'Unclarified name';

/** One ledger row, as the reports need it. */
export interface ReportRow {
  /** Signed from the bank's side: > 0 money in, < 0 money out. */
  amount: number;
  offsetAccount: string;
  /** The bank side of the entry, e.g. "Chase 4362"; null = no cash side. */
  bankAccount: string | null;
  /** YYYY-MM-DD the row counts on; null when the statement printed no date. */
  date: string | null;
  /** The payee, for the income statement's per-name totals; null = Unclarified name. */
  name?: string | null;
  /**
   * The same amount in the bank account's OWN currency, when that is not the home
   * currency (`amount` is then converted). A revaluation row has 0 here.
   */
  foreign?: number;
}

/** What else decides the reports, besides the rows (all optional). */
export interface ReportOptions {
  /** Tax agencies: LIABILITY accounts outside the chart. */
  liabilityAccounts?: string[];
  /** The customer's OWN categories (`CustomerAccount`) and the type they picked. */
  customTypes?: ReadonlyMap<string, AccountType>;
  /** Accounts the customer moved to another section (`CustomerAccountType`). */
  overrides?: ReadonlyMap<string, AccountType>;
  /** Statement accounts that are credit cards — a LIABILITY, the balance owed shown positive. */
  creditCards?: ReadonlySet<string>;
  /**
   * Each statement account's currency (the customer's setting, else what its statements
   * say, else home). A foreign one also gets its balance in that currency (`foreign`).
   */
  bankCurrencies?: ReadonlyMap<string, { currency: string; foreign: boolean }>;
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
  /** A statement account's currency (see `ReportOptions.bankCurrencies`). */
  currency?: string;
  /** A foreign statement account's balance in its own currency (`balance` is converted). */
  foreignBalance?: number;
}

export interface ReportLine {
  name: string;
  amount: number;
  /** A statement account (bank / card) itself. */
  bank?: boolean;
  /** Income statement only: the account's total per payee, largest first. */
  byName?: ReportLine[];
  /** A foreign statement account: its currency and `amount` before conversion. */
  currency?: string;
  foreignAmount?: number;
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
  /** Accounts the customer moved to another section (they can be put back). */
  moved: string[];
}

export const RETAINED_EARNINGS = 'Retained Earnings';

const TYPE_OF = new Map(CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));

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
  /** Σ `foreign` in cents (bank accounts only). */
  foreign: number;
}

/**
 * Totals per offset account and per bank account, in cents. A row with no date counts
 * only when there is no bound to test it against.
 */
function tally(rows: ReportRow[], from: string | null, to: string | null) {
  const offsets = new Map<string, Tally>();
  const banks = new Map<string, Tally>();
  /** offset account → payee → Σ cents. */
  const names = new Map<string, Map<string, number>>();
  const add = (m: Map<string, Tally>, key: string, c: number, f = 0) => {
    const t = m.get(key) ?? { sum: 0, count: 0, foreign: 0 };
    t.sum += c;
    t.count += 1;
    t.foreign += f;
    m.set(key, t);
  };
  for (const r of rows) {
    if ((from || to) && !r.date) continue;
    if (from && r.date! < from) continue;
    if (to && r.date! > to) continue;
    const c = cents(r.amount);
    add(offsets, r.offsetAccount, c);
    if (r.bankAccount !== null) {
      add(
        banks,
        r.bankAccount,
        c,
        r.foreign === undefined ? 0 : cents(r.foreign),
      );
    }
    const per = names.get(r.offsetAccount) ?? new Map<string, number>();
    const who = r.name?.trim() || UNCLARIFIED_NAME;
    per.set(who, (per.get(who) ?? 0) + c);
    names.set(r.offsetAccount, per);
  }
  return { offsets, banks, names };
}

/** The offset account's balance on its normal side, in cents. */
const normal = (type: AccountType, sum: number): number =>
  CREDIT_NORMAL.has(type) ? sum : -sum;
/** A statement account's own balance on its normal side (Σ amount is from ITS side). */
const bankNormal = (type: AccountType, sum: number): number =>
  -normal(type, sum);
const BALANCE_SHEET: ReadonlySet<AccountType> = new Set([
  'ASSET',
  'LIABILITY',
  'EQUITY',
]);

/**
 * Chart of accounts, income statement and balance sheet from the ledger.
 *
 * Every row is a double entry between a statement account and its offset account, so the
 * balance sheet balances by construction: the account = Σ amount, and every Σ amount
 * lands on the other side in an income, expense, asset, liability or equity account.
 * A bank account is an asset; a CREDIT CARD a liability (Σ amount is −owed, shown +owed).
 * The bank's printed starting balances arrive as rows too ("Starting balance" →
 * Owner's Loan, `opening-balance.util.ts`), and net income to date is Retained Earnings.
 */
export function buildReports(
  rows: ReportRow[],
  from: string | null = null,
  to: string | null = null,
  options: ReportOptions = {},
): ReportsView {
  const customTypes = options.customTypes ?? new Map<string, AccountType>();
  const overrides = options.overrides ?? new Map<string, AccountType>();
  const bankNames = [
    ...new Set(
      rows.map((r) => r.bankAccount).filter((b): b is string => b !== null),
    ),
  ].sort();
  const ctx = {
    overrides,
    liabilities: new Set(options.liabilityAccounts ?? []),
    custom: customTypes,
  };
  const typeOf = (name: string): AccountType => typeFor(name, ctx);
  /** A statement account's currency, plus its own-currency amount when foreign. */
  const inCurrency = (
    name: string,
    type: AccountType,
    t: Tally | undefined,
  ) => {
    const c = options.bankCurrencies?.get(name);
    if (!c) return {};
    return c.foreign
      ? {
          currency: c.currency,
          foreign: dollars(bankNormal(type, t?.foreign ?? 0)),
        }
      : { currency: c.currency };
  };
  /** A statement account's section: a card is a liability; a move keeps it on the sheet. */
  const bankType = (name: string): AccountType => {
    const moved = overrides.get(name);
    if (moved && BALANCE_SHEET.has(moved)) return moved;
    return options.creditCards?.has(name) ? 'LIABILITY' : 'ASSET';
  };

  // ---- chart of accounts + income statement: the period ----
  const period = tally(rows, from, to);
  const chartNames = CHART_OF_ACCOUNTS.map((a) => a.name);
  // The customer's own categories are listed even before a row uses them — one they just
  // created shows at once, at zero. Then anything else with rows that is not in the chart.
  const own = [...customTypes.keys()].filter((n) => !TYPE_OF.has(n));
  const extra = [
    ...own,
    ...[...period.offsets.keys()].filter(
      (n) => !TYPE_OF.has(n) && !customTypes.has(n),
    ),
  ];
  const accounts: AccountBalance[] = [
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

  const byName = (account: string, type: AccountType): ReportLine[] =>
    [...(period.names.get(account) ?? new Map<string, number>())]
      .map(([name, sum]) => ({ name, amount: dollars(normal(type, sum)) }))
      .filter((l) => l.amount !== 0)
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  const lines = (type: AccountType): ReportLine[] =>
    accounts
      .filter((a) => !a.bank && a.type === type && a.count > 0)
      .map((a) => ({
        name: a.name,
        amount: a.balance,
        byName: byName(a.name, type),
      }));
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

  const banksIn = (type: AccountType): ReportLine[] =>
    bankNames
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
  const assets: ReportLine[] = [...banksIn('ASSET'), ...sheetLines('ASSET')];
  const liabilities = [...banksIn('LIABILITY'), ...sheetLines('LIABILITY')];
  const equity: ReportLine[] = [
    ...banksIn('EQUITY'),
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
    moved: [...overrides.keys()],
  };
}
