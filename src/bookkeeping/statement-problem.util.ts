import type { Prisma } from '@prisma/client';
import type { StartDerived, StartReason } from './opening-balance.util';
import { describeCheck, type Check } from './reconcile.util';

/**
 * step2 (2026-11-11, user's request): every problem a read statement can have is ONE of
 * these, said plainly on its row on Bank feeds (worst first when two apply):
 * - BALANCE: its own transactions do not add up to its balances / totals, after every
 *   re-read (NEEDS_REVIEW — out of the books).
 * - ENDING (step2, 2026-11-12): read and in the books (DONE), but its opening ± the rows
 *   we read does not reach its own closing balance — whatever `verification` says (a balance
 *   set from the chat, a strong re-read that was set back, a customer's figures).
 * - MISMATCH: it opens at a different balance than the previous statement of the account
 *   ended, although their periods touch — both were re-read once on the strong model
 *   (`StatementContinuityService`); the books start again here.
 * - MISSING: a gap in the periods before it; the books start again here.
 * - NO_BALANCES: nothing proved its rows (UNVERIFIED — no balances, totals or running
 *   balance to check them against), even on the strong model (in the books as read).
 * step9 (2026-11-15, user's request: "every statement should have a starting balance and the
 * ending balance should match the running balance"):
 * - RUNNING: the running balance printed on its last row does not reach its closing balance
 *   (or, with no closing printed, opening ± the rows).
 * - NO_OPENING: no starting balance printed AND none can be worked out (no closing either —
 *   `openingChain` set it at $0, `derived: 'ZERO'`). A starting balance worked out from the
 *   closing is NOT an error (user's decision).
 * Since step9 the problems are SAVED (`StatementError`, `StatementErrorsService`): this file is
 * the check — `statementErrors` gives every one, `statementProblem` the worst.
 */
export type ProblemKind =
  | 'BALANCE'
  | 'ENDING'
  | 'RUNNING'
  | 'MISMATCH'
  | 'MISSING'
  | 'NO_OPENING'
  | 'NO_BALANCES';

export interface StatementProblem {
  kind: ProblemKind;
  /** The short label shown instead of "Done" / "Needs review". */
  title: string;
  /** One or two sentences with the figures. */
  text: string;
  /** step9: the figures behind it, saved with the error (`StatementError.details`). */
  details?: Record<string, unknown>;
}

/** Worst first — the order `statementErrors` lists them in. */
export const PROBLEM_ORDER: ProblemKind[] = [
  'BALANCE',
  'ENDING',
  'RUNNING',
  'MISMATCH',
  'MISSING',
  'NO_OPENING',
  'NO_BALANCES',
];

export const PROBLEM_TITLES: Record<ProblemKind, string> = {
  BALANCE: "Transactions don't match the balance",
  ENDING: "Ending balance doesn't match",
  RUNNING: "Ending balance doesn't match the running balance",
  MISMATCH: "Statement didn't match",
  MISSING: 'Missing statements',
  NO_OPENING: 'No starting balance',
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
  /** Σ its own rows (step2, 2026-11-12); absent = the ending is not checked here. */
  net?: number;
  /** 'CREDIT_CARD' = its balances are the amount OWED. */
  accountKind?: string | null;
  /** Why the books start again at this statement (`openingRows`), if they do. */
  reason?: StartReason | null;
  /** Both statements of a MISMATCH were re-read on the strong model already. */
  rechecked?: boolean;
  /** One of them is being re-read right now. */
  rechecking?: boolean;
  /**
   * step9: the running balance printed on the statement's LAST row (`printedEnding`);
   * absent / null = none printed, the running balance is not checked.
   */
  printedEnding?: number | null;
  /** step9: how its starting balance was worked out (`openingChain`), when not read. */
  startDerived?: StartDerived;
}

/** The statement's worst problem, or null when it has none. Pure. */
export function statementProblem(s: ProblemInput): StatementProblem | null {
  return statementErrors(s)[0] ?? null;
}

/** step9: EVERY problem the statement has, worst first (`PROBLEM_ORDER`). Pure. */
export function statementErrors(s: ProblemInput): StatementProblem[] {
  if (s.status === 'NEEDS_REVIEW') return [balanceProblem(s)];
  if (s.status !== 'DONE') return [];
  return [
    endingProblem(s),
    runningProblem(s),
    chainProblem(s),
    noOpeningProblem(s),
    noBalancesProblem(s),
  ].filter((p): p is StatementProblem => p !== null);
}

function balanceProblem(s: ProblemInput): StatementProblem {
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

/** MISMATCH / MISSING: the account's books start again at this statement. */
function chainProblem(s: ProblemInput): StatementProblem | null {
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
    return {
      kind: 'MISMATCH',
      title: PROBLEM_TITLES.MISMATCH,
      text: head + tail,
    };
  }
  if (r?.kind === 'MISSING') {
    const to = r.to ? `to ${longDay(r.to)}` : 'up to this one';
    const restart =
      s.openingBalance === null
        ? ''
        : ` Your books start again here at ${money(s.openingBalance)}.`;
    // step2 (2026-11-12): say when the balance jumped across the gap too (#278: $1,024.43 → $0).
    const jump =
      r.previousClosing != null &&
      s.openingBalance !== null &&
      Math.round(r.previousClosing * 100) !== Math.round(s.openingBalance * 100)
        ? ` The statement before it ends at ${money(r.previousClosing)}; this one opens at ${money(s.openingBalance)}.`
        : '';
    return {
      kind: 'MISSING',
      title: PROBLEM_TITLES.MISSING,
      text: `No statement from ${longDay(r.from)} ${to}.${jump}${restart} Upload the missing statement${r.to && monthsBetween(r.from, r.to) > 1 ? 's' : ''} to fix it.`,
    };
  }
  return null;
}

/**
 * NO_OPENING (step9): no starting balance printed and none could be worked out — no closing
 * balance either, so the books start this account at $0 here. Never a bank-feed month (built
 * from the bank's own balances).
 */
function noOpeningProblem(s: ProblemInput): StatementProblem | null {
  if (s.source === 'PLAID' || s.startDerived !== 'ZERO') return null;
  if (s.openingBalance !== null || s.closingBalance !== null) return null;
  return {
    kind: 'NO_OPENING',
    title: PROBLEM_TITLES.NO_OPENING,
    text:
      "We couldn't read a starting balance on this statement, and no closing balance to work one out from, so your books start this account at $0.00 here. " +
      'Try again, or tell the AI the starting balance printed on it.',
  };
}

function noBalancesProblem(s: ProblemInput): StatementProblem | null {
  // NO_OPENING already says it when neither balance was read.
  if (noOpeningProblem(s)) return null;
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
 * ENDING: a read statement (not a bank-feed month — built from its own balances) whose
 * opening ± its rows does not reach its closing, to the cent. A card prints the balance
 * OWED, so its purchases (negative rows) raise it: opening − net. Pure.
 */
function endingProblem(s: ProblemInput): StatementProblem | null {
  if (s.source === 'PLAID' || s.net === undefined) return null;
  if (s.openingBalance === null || s.closingBalance === null) return null;
  const card = s.accountKind === 'CREDIT_CARD';
  const c = (n: number) => Math.round(n * 100);
  const should = c(s.openingBalance) + (card ? -1 : 1) * c(s.net);
  const ends = c(s.closingBalance);
  if (should === ends) return null;
  const moneyIn = s.net > 0 ? s.net : 0;
  const moneyOut = s.net < 0 ? -s.net : 0;
  return {
    kind: 'ENDING',
    title: PROBLEM_TITLES.ENDING,
    text:
      `It starts at ${money(s.openingBalance)}; with the transactions we read (net ${moneyIn ? `${money(moneyIn)} in` : `${money(moneyOut)} out`}) it should end at ${money(should / 100)}, ` +
      `but the statement ends at ${money(s.closingBalance)} (off by ${money(Math.abs(ends - should) / 100)}). ` +
      'Its transactions are in your books as read — try again, or ask the AI to fix it.',
    details: {
      opening: s.openingBalance,
      net: s.net,
      expected: should / 100,
      closing: s.closingBalance,
    },
  };
}

/**
 * RUNNING (step9): the running balance printed on the statement's last row is where the bank
 * says it ends. It must be its closing balance — or, with none printed, opening ± the rows.
 * Compared without sign (a card prints the balance OWED either way), never on a bank-feed
 * month (its running balance is ours), and never when the reader judged the printed "balances"
 * were not a running balance (its `runningBalance` check skipped).
 */
function runningProblem(s: ProblemInput): StatementProblem | null {
  if (s.source === 'PLAID') return null;
  if (s.printedEnding === undefined || s.printedEnding === null) return null;
  const running = storedChecks(s.verificationDetail).find(
    (c) => c.name === 'runningBalance' && c.page == null,
  );
  if (running?.skipped) return null;
  const card = s.accountKind === 'CREDIT_CARD';
  const c = (n: number) => Math.round(n * 100);
  const target =
    s.closingBalance !== null
      ? { cents: c(s.closingBalance), what: 'its closing balance' }
      : s.openingBalance !== null && s.net !== undefined
        ? {
            cents: c(s.openingBalance) + (card ? -1 : 1) * c(s.net),
            what: 'its starting balance plus its transactions',
          }
        : null;
  if (!target) return null;
  const printed = c(s.printedEnding);
  if (Math.abs(printed) === Math.abs(target.cents)) return null;
  const off = Math.abs(Math.abs(printed) - Math.abs(target.cents));
  return {
    kind: 'RUNNING',
    title: PROBLEM_TITLES.RUNNING,
    text:
      `The running balance on its last transaction is ${money(printed / 100)}, but ${target.what} comes to ${money(target.cents / 100)} (off by ${money(off / 100)}). ` +
      'A transaction was probably misread or missed — try again, or ask the AI to fix it.',
    details: { printedEnding: printed / 100, expected: target.cents / 100 },
  };
}

/**
 * The running balance printed on a statement's last row, in the bank's order: rows in
 * `position` order, or — when they run newest first (the first dated row is later than the
 * last) — the first printed balance. Null = no running balance printed. Pure.
 */
export function printedEnding(
  rows: Array<{ balanceAfter: number | null; postingDate: string | null }>,
): number | null {
  const printed = rows.filter((r) => r.balanceAfter !== null);
  if (printed.length === 0) return null;
  const dated = rows.filter((r) => r.postingDate);
  const newestFirst =
    dated.length >= 2 &&
    dated[0].postingDate! > dated[dated.length - 1].postingDate!;
  return (newestFirst ? printed[0] : printed[printed.length - 1]).balanceAfter;
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
