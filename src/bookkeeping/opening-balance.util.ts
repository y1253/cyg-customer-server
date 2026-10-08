import { OWNERS_LOAN } from './chart-of-accounts';
import { doubleEntry } from './ledger.util';
import { cents } from './reconcile.util';

/** A DONE statement, as far as its starting balance is concerned. */
export interface OpeningStatement {
  id: number;
  accountName: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  periodStart: Date | null;
}

/** One "Starting balance" row — computed on read, NEVER stored in `BankTransaction`. */
export interface OpeningRow {
  statementId: number;
  bankAccount: string;
  /** Signed from the bank's side, like every ledger amount. */
  amount: number;
  /** The statement's first day; null when it printed no period. */
  postingDate: Date | null;
  description: string;
  offsetAccount: string;
  debitAccount: string;
  creditAccount: string;
}

export const STARTING_BALANCE = 'Starting balance';

/**
 * The printed starting balance of each statement as a ledger row, offset to Owner's Loan.
 *
 * Statements are chained per bank account (`accountName`, the same "Bank account"
 * fallback `processOne` uses), in `periodStart` order: a statement whose opening balance
 * equals, to the cent, the closing balance of the PREVIOUS statement of that account
 * continues it and gets no row. Any other statement (the first one, or one after a gap
 * or a mismatch) gets its full printed balance. No opening balance, or zero → no row.
 *
 * Computed when the ledger, exports and reports are READ, so it is never part of the
 * AI rows `reconcile()` checks, and it follows uploads, deletes and retries by itself.
 */
export function openingRows(statements: OpeningStatement[]): OpeningRow[] {
  const byAccount = new Map<string, OpeningStatement[]>();
  for (const s of statements) {
    const bank = s.accountName ?? 'Bank account';
    byAccount.set(bank, [...(byAccount.get(bank) ?? []), s]);
  }

  const time = (d: Date | null) => d?.getTime() ?? -Infinity;
  const out: OpeningRow[] = [];
  for (const [bankAccount, list] of byAccount) {
    list.sort(
      (a, b) => time(a.periodStart) - time(b.periodStart) || a.id - b.id,
    );
    list.forEach((s, i) => {
      if (s.openingBalance === null || cents(s.openingBalance) === 0) return;
      const prev = list[i - 1]?.closingBalance;
      if (
        prev !== undefined &&
        prev !== null &&
        cents(prev) === cents(s.openingBalance)
      )
        return;
      const amount = cents(s.openingBalance) / 100;
      out.push({
        statementId: s.id,
        bankAccount,
        amount,
        postingDate: s.periodStart,
        description: STARTING_BALANCE,
        offsetAccount: OWNERS_LOAN,
        ...doubleEntry(amount, bankAccount, OWNERS_LOAN),
      });
    });
  }
  return out;
}

/** A Prisma Decimal (or null) as a number, for `OpeningStatement`. */
export const num = (d: { toString(): string } | null): number | null =>
  d === null ? null : Number(d);

/** What to load per statement: the chain fields plus what `statementLabel` needs. */
export const OPENING_STATEMENT_SELECT = {
  id: true,
  accountName: true,
  bankName: true,
  filename: true,
  openingBalance: true,
  closingBalance: true,
  periodStart: true,
  periodEnd: true,
} as const;

/** Where a Starting balance row sits within its statement: before row 0. */
export const OPENING_POSITION = -1;

/**
 * Oldest first — the same order as Prisma's `postingDate asc, statementId asc,
 * position asc` on MySQL, where a null date sorts first. Negate for newest first.
 */
export function ledgerOrder(
  a: { postingDate: Date | null; statementId: number; position: number },
  b: { postingDate: Date | null; statementId: number; position: number },
): number {
  const t = (d: Date | null) => d?.getTime() ?? -Infinity;
  const ta = t(a.postingDate);
  const tb = t(b.postingDate);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.statementId - b.statementId || a.position - b.position;
}
