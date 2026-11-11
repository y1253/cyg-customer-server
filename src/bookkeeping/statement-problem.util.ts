import type { Prisma } from '@prisma/client';
import type { StartReason } from './opening-balance.util';
import { describeCheck, type Check } from './reconcile.util';

/**
 * step2 (2026-11-11, user's request): every problem a read statement can have is ONE of
 * these, said plainly on its row on Bank feeds (worst first when two apply):
 * - BALANCE: its own transactions do not add up to its balances / totals, after every
 *   re-read (NEEDS_REVIEW — out of the books).
 * - MISMATCH: it opens at a different balance than the previous statement of the account
 *   ended, although their periods touch — both were re-read once on the strong model
 *   (`StatementContinuityService`); the books start again here.
 * - MISSING: a gap in the periods before it; the books start again here.
 * - NO_BALANCES: nothing proved its rows (UNVERIFIED — no balances, totals or running
 *   balance to check them against), even on the strong model (in the books as read).
 * Computed on READ, never stored, so a move / delete / retry never leaves a stale one.
 */
export type ProblemKind = 'BALANCE' | 'MISMATCH' | 'MISSING' | 'NO_BALANCES';

export interface StatementProblem {
  kind: ProblemKind;
  /** The short label shown instead of "Done" / "Needs review". */
  title: string;
  /** One or two sentences with the figures. */
  text: string;
}

export const PROBLEM_TITLES: Record<ProblemKind, string> = {
  BALANCE: "Transactions don't match the balance",
  MISMATCH: "Statement didn't match",
  MISSING: 'Missing statements',
  NO_BALANCES: "Couldn't check — balances not read",
};
const TOTALS_TITLE = "Transactions don't match the bank's totals";

export interface ProblemInput {
  status: string;
  /** NEEDS_REVIEW: the sentence the processor wrote (`needsReviewText`). */
  error: string | null;
  verification: string | null;
  verificationDetail: Prisma.JsonValue | null;
  source: string;
  openingBalance: number | null;
  closingBalance: number | null;
  /** Why the books start again at this statement (`openingRows`), if they do. */
  reason?: StartReason | null;
  /** Both statements of a MISMATCH were re-read on the strong model already. */
  rechecked?: boolean;
  /** One of them is being re-read right now. */
  rechecking?: boolean;
}

/** The statement's problem, or null when it has none. Pure. */
export function statementProblem(s: ProblemInput): StatementProblem | null {
  if (s.status === 'NEEDS_REVIEW') {
    const balance = storedChecks(s.verificationDetail).find(
      (c) => c.name === 'balance' && c.page == null,
    );
    return {
      kind: 'BALANCE',
      title: !balance || balance.ok ? TOTALS_TITLE : PROBLEM_TITLES.BALANCE,
      text:
        s.error ??
        "Its transactions don't add up to the statement's own balances. Nothing from it is in your books yet.",
    };
  }
  if (s.status !== 'DONE') return null;
  const r = s.reason;
  if (r?.kind === 'MISMATCH') {
    const before = r.previousEnd
      ? `The statement ending ${longDay(r.previousEnd)}`
      : 'The statement before it';
    const closed =
      r.previousClosing === null
        ? 'has no closing balance we could read'
        : `closes at ${money(r.previousClosing)}`;
    const head = `${before} ${closed}; this one opens at ${money(r.opening)}.`;
    const tail = s.rechecking
      ? " We're re-reading both with our strongest reader."
      : s.rechecked
        ? ` We re-read both with our strongest reader and they still don't match, so your books start again here at ${money(r.opening)}.`
        : ` Your books start again here at ${money(r.opening)}.`;
    return { kind: 'MISMATCH', title: PROBLEM_TITLES.MISMATCH, text: head + tail };
  }
  if (r?.kind === 'MISSING') {
    const to = r.to ? `to ${longDay(r.to)}` : 'up to this one';
    const restart =
      s.openingBalance === null
        ? ''
        : ` Your books start again here at ${money(s.openingBalance)}.`;
    return {
      kind: 'MISSING',
      title: PROBLEM_TITLES.MISSING,
      text: `No statement from ${longDay(r.from)} ${to}.${restart} Upload the missing statement${r.to && monthsBetween(r.from, r.to) > 1 ? 's' : ''} to fix it.`,
    };
  }
  // A bank-feed month has no printed balances to read — it is built from them. Only
  // UNVERIFIED: a statement proved by its printed totals or running balance IS checked, even
  // without a closing-balance line (TD prints none — 16 false alarms in book 2, 2026-11-11).
  if (s.source !== 'PLAID' && s.verification === 'UNVERIFIED') {
    const which =
      s.openingBalance === null && s.closingBalance === null
        ? 'opening or closing balance'
        : s.openingBalance === null
          ? 'opening balance'
          : 'closing balance';
    return {
      kind: 'NO_BALANCES',
      title: PROBLEM_TITLES.NO_BALANCES,
      text: `We couldn't read this statement's ${which}, so nothing checked its transactions. They are in your books as read — tell the AI the balances printed on it to check them.`,
    };
  }
  return null;
}

/**
 * The sentence a statement that still does not add up after every re-read is stored with
 * (`error`, shown on its row). Pure.
 */
export function needsReviewText(input: {
  rereads: number;
  checks: Check[];
  openingBalance: number | null;
  /** The rows as read, in the bank's sign (+ = money in). */
  amounts: number[];
}): string {
  const failed = input.checks.filter((c) => !c.ok && !c.skipped);
  const balance = failed.find((c) => c.name === 'balance' && c.page == null);
  let what: string;
  if (balance && input.openingBalance !== null) {
    const cents = input.amounts.map((a) => Math.round(a * 100));
    const moneyIn = cents.filter((a) => a > 0).reduce((t, a) => t + a, 0);
    const moneyOut = -cents.filter((a) => a < 0).reduce((t, a) => t + a, 0);
    what =
      `It starts at ${money(input.openingBalance)}; with the money in (${money(moneyIn / 100)}) and out (${money(moneyOut / 100)}) we read, it should end at ${money(balance.actual / 100)} — ` +
      `but the statement ends at ${money(balance.expected / 100)} (off by ${money(Math.abs(balance.expected - balance.actual) / 100)}).`;
  } else {
    what = `The transactions we read don't add up to the bank's own figures: ${failed.map(describeCheck).join('; ') || 'its totals'}.`;
  }
  const times = `${input.rereads} time${input.rereads === 1 ? '' : 's'}`;
  return (
    `${what} We re-read it ${times}, including with our strongest reader. ` +
    'Nothing from it is in your books yet — try again, or ask the AI to fix it.'
  );
}

function storedChecks(detail: Prisma.JsonValue | null): Check[] {
  return Array.isArray(detail)
    ? (detail.filter((c) => c && typeof c === 'object') as unknown as Check[])
    : [];
}

/** "$1,234.56" / "-$12.00". */
export function money(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? '-' : ''}$${abs}`;
}

/** "2026-02-28" → "Feb 28, 2026". */
function longDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

/** Calendar months touched from `from` to `to` (YYYY-MM-DD). */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}
