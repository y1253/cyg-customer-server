import { OWNERS_LOAN } from './chart-of-accounts';
import { doubleEntry } from './ledger.util';
import { cents } from './reconcile.util';

/** A DONE statement, as far as its starting balance is concerned. */
export interface OpeningStatement {
  id: number;
  accountName: string | null;
  /** 'CREDIT_CARD' = the printed balances are the amount OWED. Anything else = a bank. */
  accountKind?: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  periodStart: Date | null;
  /** Σ amount of the statement's own (AI-read) rows. */
  net: number;
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
 * fallback `processOne` uses), in `periodStart` order — never upload order: a statement
 * whose opening balance equals, to the cent, the ending balance of the PREVIOUS statement
 * of that account continues it and gets no row. The ending balance is any of `endingsOf`:
 * the printed `closingBalance` or opening ± Σ rows (TD has no labelled closing line; "−"
 * because a credit card prints the balance OWED), each with either sign. Any other
 * statement (the first one, or one after a real gap) gets its full printed balance (user's
 * decision, kept 2026-10-18). No opening balance, or zero → no row.
 *
 * A CREDIT CARD's printed balance is a DEBT: "Previous balance $500" is −$500 on the card
 * (debit Owner's Loan / credit the card), so with purchases negative and payments positive
 * the card ends at −(New balance) — a liability in the reports (`buildReports`). Posting it
 * as +$500 showed an Amex owing $600 as $400 of cash (2026-10-14).
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
      const prev = list[i - 1];
      if (prev && endingsOf(prev).includes(cents(s.openingBalance))) return;
      const sign = isCreditCard(s.accountKind) ? -1 : 1;
      const amount = (sign * cents(s.openingBalance)) / 100;
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

export const CREDIT_CARD = 'CREDIT_CARD';
export const isCreditCard = (kind: string | null | undefined): boolean =>
  kind === CREDIT_CARD;

/**
 * Where a statement may have ended, in cents (see `openingRows`): the printed closing AND
 * opening ± Σ rows, each also negated. A printed closing alone is not trusted — a TD
 * per-page figure stored as the closing broke a chain that opening + Σ rows proved, and the
 * next statement's opening was posted on top of the old balance (2026-10-18). Negated: an
 * overdrawn "1,468.82-" stored without its minus on one statement and with it on the next.
 */
export function endingsOf(s: OpeningStatement): number[] {
  const out: number[] = [];
  if (s.closingBalance !== null) out.push(cents(s.closingBalance));
  if (s.openingBalance !== null) {
    const open = cents(s.openingBalance);
    const net = cents(s.net);
    out.push(open + net, open - net);
  }
  return [...new Set(out.flatMap((c) => [c, -c]))];
}

/** A Prisma Decimal (or null) as a number, for `OpeningStatement`. */
export const num = (d: { toString(): string } | null): number | null =>
  d === null ? null : Number(d);

/** What to load per statement: the chain fields plus what `statementLabel` needs. */
export const OPENING_STATEMENT_SELECT = {
  id: true,
  accountName: true,
  accountKind: true,
  currency: true,
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
