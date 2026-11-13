import { OWNERS_LOAN } from './chart-of-accounts';
import { doubleEntry } from './ledger.util';
import { cents } from './reconcile.util';

/** A DONE statement, as far as its starting balance is concerned. */
export interface OpeningStatement {
  id: number;
  /**
   * A statement that is NOT in the ledger (NEEDS_REVIEW — its rows don't add up yet) but
   * still links the chain: its printed balances carry over, it never gets a row itself.
   */
  bridgeOnly?: boolean;
  accountName: string | null;
  /** 'CREDIT_CARD' = the printed balances are the amount OWED. Anything else = a bank. */
  accountKind?: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  periodStart: Date | null;
  /**
   * Its last day. Orders the chain when no start was printed: BMO prints only "for the
   * period ending …", and sorting those statements first broke BMO 6454's chain (2026-11-10).
   */
  periodEnd?: Date | null;
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
  /** The statement's last day — the date a start is shown with when it printed no start. */
  periodEnd: Date | null;
  /** Why the account starts again here; absent on its first start (that one is normal). */
  reason?: StartReason;
  /**
   * step2 (2026-11-12): a break with NOTHING to post — the statement opens at $0 (or its
   * opening was not read) where the previous one did not end there. Never a ledger row
   * (`openingRows` leaves it out); only `openingChain` returns it, so the break is shown.
   */
  silent?: true;
  /** A silent start whose opening was not read: where the books start, with no amount known. */
  unread?: true;
}

/**
 * Why a statement after the first gets its own Starting balance — the only two causes:
 * - MISSING: no statement covers `from` – `to` (YYYY-MM-DD; `to` null = up to this one,
 *   which printed no start). Upload the missing statement.
 * - MISMATCH: the periods touch, but this opening is not where the previous statement
 *   ended (`previousClosing`: its printed closing, else opening + Σ rows). One of the two
 *   balances, or the previous statement's rows, was read wrong.
 */
export type StartReason =
  | {
      kind: 'MISSING';
      previousStatementId: number;
      from: string;
      to: string | null;
      /** Where the previous statement ended (step2, 2026-11-12; null = not known). */
      previousClosing?: number | null;
      /** Where this one opens (null = not read). */
      opening?: number | null;
    }
  | {
      kind: 'MISMATCH';
      previousStatementId: number;
      previousEnd: string | null;
      previousClosing: number | null;
      opening: number;
    }
  | {
      /**
       * The statement before it could not be reconciled (NEEDS_REVIEW, out of the books) and
       * does not carry over, so the books start again here — whatever the two balances say
       * (2026-11-12: Amex #254 / #266 said "didn't match" while opening at exactly the
       * closing of the NEEDS_REVIEW statement before them). Its own row already shows why.
       */
      kind: 'REVIEW';
      previousStatementId: number;
      previousEnd: string | null;
    };

export const STARTING_BALANCE = 'Starting balance';

/**
 * The printed starting balance of each statement as a ledger row, offset to Owner's Loan.
 *
 * Statements are chained per bank account (`accountName`, the same "Bank account"
 * fallback `processOne` uses), in `periodStart` order (`periodEnd` when no start was
 * printed — BMO, 2026-11-10) — never upload order: a statement
 * whose opening balance equals, to the cent, the ending balance of the PREVIOUS statement
 * of that account continues it and gets no row. The ending balance is any of `endingsOf`:
 * the printed `closingBalance` or opening ± Σ rows (TD has no labelled closing line; "−"
 * because a credit card prints the balance OWED), each with either sign. A statement whose
 * opening was not read is BRIDGED: its endings are the previous endings ± its own rows, so
 * TD 5234's March statement continued February through two statements with no opening
 * read (2026-10-19; comparing with the direct predecessor alone found no ending). Any other
 * statement (the first one, or one after a real gap) gets its full printed balance (user's
 * decision, kept 2026-10-18). No opening balance, or zero → no row.
 *
 * A CREDIT CARD's printed balance is a DEBT: "Previous balance $500" is −$500 on the card
 * (debit Owner's Loan / credit the card), so with purchases negative and payments positive
 * the card ends at −(New balance) — a liability in the reports (`buildReports`). Posting it
 * as +$500 showed an Amex owing $600 as $400 of cash (2026-10-14).
 *
 * A statement we could not reconcile (NEEDS_REVIEW) is not in the ledger, but it sits in
 * the account's folder between two that are: it is passed as a `bridges` entry and links
 * the chain when its opening continues it (or was not read). Leaving it out made the
 * statement after it look like a new start (step12, the TD March statement, 2026-10-20).
 * One that does NOT continue is a real break — the next statement starts fresh, as before.
 *
 * Computed when the ledger, exports and reports are READ, so it is never part of the
 * AI rows `reconcile()` checks, and it follows uploads, deletes and retries by itself.
 */
export function openingRows(
  statements: OpeningStatement[] & { bridges?: OpeningStatement[] },
  bridges: OpeningStatement[] = statements.bridges ?? [],
): OpeningRow[] {
  return openingChain(statements, bridges).filter((r) => !r.silent);
}

/**
 * `openingRows` plus the SILENT breaks (step2, 2026-11-12): a statement that opens at $0,
 * or whose opening was not read, after a statement that did not end at $0 / across a gap.
 * Chase 4148 #278 opened at $0 three months after #273 ended at $1,024.43 and the Bank
 * feeds tab said nothing — a $0 opening never got a start, so `breakReason` never ran.
 * What shows where an account starts (`startsByAccount`) and which pairs are re-read
 * (`mismatchPairs`) reads THIS; the ledger, reports and export read `openingRows`.
 */
export function openingChain(
  statements: OpeningStatement[] & { bridges?: OpeningStatement[] },
  bridges: OpeningStatement[] = statements.bridges ?? [],
): OpeningRow[] {
  const byAccount = new Map<string, OpeningStatement[]>();
  const bridgeRows = bridges.map((b) => ({ ...b, bridgeOnly: true }));
  for (const s of [...statements, ...bridgeRows]) {
    const bank = s.accountName ?? 'Bank account';
    byAccount.set(bank, [...(byAccount.get(bank) ?? []), s]);
  }

  const out: OpeningRow[] = [];
  for (const [bankAccount, list] of byAccount) {
    list.sort((a, b) => chainTime(a) - chainTime(b) || a.id - b.id);
    let carried: number[] = [];
    let previous: OpeningStatement | undefined;
    /** The NEEDS_REVIEW statement the chain broke at, until a statement in the books follows. */
    let brokenBridge: OpeningStatement | undefined;
    let inBooks = false;
    for (const s of list) {
      const before = previous;
      previous = s;
      const continues =
        s.openingBalance !== null && carried.includes(cents(s.openingBalance));
      if (s.bridgeOnly) {
        carried =
          continues || s.openingBalance === null ? endingsOf(s, carried) : [];
        carried = carried.slice(0, MAX_CARRIED);
        if (continues) brokenBridge = undefined;
        else if (s.openingBalance !== null || brokenBridge) brokenBridge = s;
        continue;
      }
      const review = brokenBridge && reviewReason(brokenBridge);
      brokenBridge = undefined;
      // The account's first statement in the books: where it starts is ALWAYS listed (step2
      // follow-up, 2026-11-12) — a $0 / unread opening used to give no start at all, so
      // Madam recovery's BMO 6454 (21 statements, opening $0) showed no starting balance.
      const first = !inBooks;
      inBooks = true;
      const had = carried;
      // Never cleared when it grows: the first candidates (the printed closing, then
      // opening + Σ rows) are the likeliest, so keep those. Clearing it made the 5th
      // statement after a run of unread openings look like a new start.
      carried = endingsOf(s, carried).slice(0, MAX_CARRIED);
      if (s.openingBalance === null || cents(s.openingBalance) === 0) {
        // Nothing to post, but the books do not carry over here (or start here): say so.
        const reason = review || (before && silentBreak(before, s, had));
        if (reason || first)
          out.push({
            statementId: s.id,
            bankAccount,
            amount: 0,
            postingDate: s.periodStart,
            description: STARTING_BALANCE,
            offsetAccount: OWNERS_LOAN,
            ...doubleEntry(0, bankAccount, OWNERS_LOAN),
            periodEnd: s.periodEnd ?? null,
            ...(reason && { reason }),
            silent: true,
            ...(s.openingBalance === null && { unread: true as const }),
          });
        continue;
      }
      if (continues) continue;
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
        periodEnd: s.periodEnd ?? null,
        ...(review
          ? { reason: review }
          : before && { reason: breakReason(before, s) }),
      });
    }
  }
  return out;
}

/**
 * Where a statement sits in its account's chain: its first day, else its last (periods
 * never overlap, so an end date still falls between its neighbours' start dates); no
 * period at all → first.
 */
const chainTime = (s: OpeningStatement): number =>
  (s.periodStart ?? s.periodEnd)?.getTime() ?? -Infinity;

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Days a period may skip before the next one and still count as continuous (BMO / TD
 * periods end on the 29th or 30th and the next starts the 30th or 31st). */
const GAP_TOLERANCE_DAYS = 3;
/** With no start printed: a statement ending more than this after the previous one's end
 * covers more than one month, so one is missing. */
const MONTH_DAYS = 35;

/** Why `s` does not continue `previous` (see `StartReason`). */
function breakReason(
  previous: OpeningStatement,
  s: OpeningStatement,
): StartReason {
  const prevEnd = previous.periodEnd ?? null;
  // A card prints the balance OWED: its purchases (negative rows) raise it.
  const computed =
    previous.openingBalance === null
      ? null
      : (cents(previous.openingBalance) +
          (isCreditCard(previous.accountKind) ? -1 : 1) * cents(previous.net)) /
        100;
  const previousClosing = previous.closingBalance ?? computed;
  if (prevEnd) {
    const expected = prevEnd.getTime() + DAY_MS;
    const gap = s.periodStart
      ? s.periodStart.getTime() - expected > GAP_TOLERANCE_DAYS * DAY_MS
      : !!s.periodEnd &&
        s.periodEnd.getTime() - prevEnd.getTime() > MONTH_DAYS * DAY_MS;
    if (gap)
      return {
        kind: 'MISSING',
        previousStatementId: previous.id,
        from: isoDay(new Date(expected)),
        to: s.periodStart
          ? isoDay(new Date(s.periodStart.getTime() - DAY_MS))
          : null,
        previousClosing,
        opening: s.openingBalance,
      };
  }
  return {
    kind: 'MISMATCH',
    previousStatementId: previous.id,
    previousEnd: prevEnd ? isoDay(prevEnd) : null,
    previousClosing,
    opening: s.openingBalance ?? 0,
  };
}

/** The books start again after a NEEDS_REVIEW statement that does not carry over. */
function reviewReason(bridge: OpeningStatement): StartReason {
  return {
    kind: 'REVIEW',
    previousStatementId: bridge.id,
    previousEnd: bridge.periodEnd ? isoDay(bridge.periodEnd) : null,
  };
}

/**
 * The break a statement with nothing to post ($0 or unread opening) still is (step2,
 * 2026-11-12), or null when it carries on. A gap is always a break. With the periods
 * touching, an UNREAD opening bridges the chain (never a break); a $0 opening is one only
 * when the endings before it are known and none of them is $0.
 */
function silentBreak(
  previous: OpeningStatement,
  s: OpeningStatement,
  endings: number[],
): StartReason | null {
  const reason = breakReason(previous, s);
  if (reason.kind === 'MISSING') return reason;
  if (s.openingBalance === null || !endings.length || endings.includes(0))
    return null;
  return reason;
}

/** Where an account's books start: one Starting balance row, as the customer sees it. */
export interface StartingBalance {
  statementId: number;
  /** YYYY-MM-DD: the statement's first day, else its last; null when it printed no period. */
  date: string | null;
  amount: number;
  /** Its opening was not read: the date is known, the amount is not (`amount` is 0). */
  unread?: true;
  /** Why the account starts again here; absent on its first start. */
  reason?: StartReason;
}

/**
 * Each account's Starting balance rows, oldest first. ONE is normal (the account's first
 * statement); more than one means the chain broke — a missing statement, or balances that
 * do not carry over — which the Bank feeds tab and the balance sheet flag in red.
 */
export function startsByAccount(
  rows: OpeningRow[],
): Map<string, StartingBalance[]> {
  const out = new Map<string, StartingBalance[]>();
  for (const r of rows) {
    const list = out.get(r.bankAccount) ?? [];
    const day = r.postingDate ?? r.periodEnd;
    list.push({
      statementId: r.statementId,
      date: day ? isoDay(day) : null,
      amount: r.amount,
      ...(r.unread && { unread: r.unread }),
      ...(r.reason && { reason: r.reason }),
    });
    out.set(r.bankAccount, list);
  }
  for (const list of out.values())
    list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
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
 * `openings` (cents) stand in for an opening that was not read — the previous statement's
 * endings, so a chain bridges it.
 */
export function endingsOf(
  s: OpeningStatement,
  openings: number[] = [],
): number[] {
  const out: number[] = [];
  if (s.closingBalance !== null) out.push(cents(s.closingBalance));
  const net = cents(s.net);
  const opens =
    s.openingBalance !== null ? [cents(s.openingBalance)] : openings;
  for (const open of opens) out.push(open + net, open - net);
  return [...new Set(out.flatMap((c) => [c, -c]))];
}

/** Bridging doubles the candidates per unread opening; only the first this many are kept. */
const MAX_CARRIED = 64;

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
