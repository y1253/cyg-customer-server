import {
  cents,
  describeCheck,
  reconcile,
  score,
  totalsCoverAll,
  type Check,
  type ReconcileResult,
  type Verification,
} from './reconcile.util';
import {
  repairBalanceSigns,
  repairSigns,
  repairSignsFromTotals,
} from './sign-repair';
import { balancesFromRunning } from './statement-extractor';

/**
 * 2026-11-25 (user's request, customer 41 TD 4051): a ONE-TIME pass over every statement
 * read before today's repairs existed — signs from the running balance (2026-10-07/14), from
 * the printed totals (2026-10-21, and `totalsCoverAll` 2026-11-25), opening / closing from
 * the running balance (2026-11-11). Stored rows already carry whatever repairs existed when
 * they were read; this runs the same PURE repairs on the stored figures so the starting-
 * balance chain ("rolling") holds where the bank's own figures prove it. Nothing is guessed:
 * every repair is exact and unique, and a change is kept only when the statement checks out
 * better than it did. What this cannot prove is left to a re-read (`rolling-backfill.ts`).
 */

export interface StoredStatement {
  openingBalance: number | null;
  closingBalance: number | null;
  statedDeposits: number | null;
  statedWithdrawals: number | null;
  statedDepositCount: number | null;
  statedWithdrawalCount: number | null;
  verification: string | null;
  accountKind: string | null;
}

export interface StoredRow {
  id: number;
  amount: number;
  balanceAfter: number | null;
  postingDate: string | null;
  /** Has splits (receipt items, split rules, a hand split) — its sign is never changed here. */
  locked: boolean;
}

export interface StatementFix {
  /** Rows whose sign flips (amount negated, debit / credit swapped). */
  flips: number[];
  /** Rows whose printed running balance gets its lost minus back. */
  balances: Array<{ id: number; balanceAfter: number | null }>;
  /** Set = fill the null opening / closing with this. */
  opening?: number;
  closing?: number;
  /** Set = the statement now checks out better; store this verdict and these checks. */
  verification?: Verification;
  detail?: Array<Check & { text: string }>;
  /** Why the flips were not kept (a locked row, or not better). */
  skipped?: string;
}

export const RANK: Record<string, number> = {
  MISMATCH: 0,
  UNVERIFIED: 1,
  VERIFIED: 2,
};

const isCard = (s: StoredStatement) => s.accountKind === 'CREDIT_CARD';

function check(
  s: StoredStatement,
  rows: ReadonlyArray<{
    amount: number;
    balanceAfter: number | null;
    postingDate: string | null;
  }>,
): ReconcileResult {
  return reconcile(
    {
      openingBalance: s.openingBalance,
      closingBalance: s.closingBalance,
      totalDeposits: s.statedDeposits,
      totalWithdrawals: s.statedWithdrawals,
      depositCount: s.statedDepositCount,
      withdrawalCount: s.statedWithdrawalCount,
    },
    rows.map((r) => ({ ...r, page: 0 })),
  );
}

/** What the one-time pass changes on one stored statement (rows in `position` order). Pure. */
export function planStatementFix(
  s: StoredStatement,
  rows: StoredRow[],
): StatementFix {
  const fix: StatementFix = { flips: [], balances: [] };
  if (!rows.length) return fix;

  // 1. Signs from the printed totals, when the figures prove they cover every row.
  let amounts = rows.map((r) => r.amount);
  const totals = {
    deposits: s.statedDeposits,
    withdrawals: s.statedWithdrawals,
    depositCount: s.statedDepositCount,
    withdrawalCount: s.statedWithdrawalCount,
  };
  if (
    totalsCoverAll(
      {
        totalDeposits: s.statedDeposits,
        totalWithdrawals: s.statedWithdrawals,
        depositCount: s.statedDepositCount,
        withdrawalCount: s.statedWithdrawalCount,
      },
      amounts.map(cents),
    )
  ) {
    amounts = repairSignsFromTotals(
      amounts.map((amount) => ({ amount })),
      totals,
    ).amounts;
  }
  // 2. The running balance: lost overdraft minuses, then row signs.
  const signRows = rows.map((r, i) => ({
    amount: amounts[i],
    balanceAfter: r.balanceAfter,
  }));
  const balances = repairBalanceSigns(signRows, s.openingBalance).balances;
  amounts = repairSigns(
    signRows.map((r, i) => ({ ...r, balanceAfter: balances[i] })),
    s.openingBalance,
  ).amounts;

  const after = rows.map((r, i) => ({
    ...r,
    amount: amounts[i],
    balanceAfter: balances[i],
  }));
  const before = check(s, rows);
  let result = before;
  let current: typeof after | StoredRow[] = rows;
  const flips = rows
    .filter((r, i) => cents(r.amount) !== cents(amounts[i]))
    .map((r) => r.id);
  const balanceChanges = rows
    .map((r, i) => ({ id: r.id, from: r.balanceAfter, to: balances[i] }))
    .filter(
      (b) =>
        (b.from === null ? null : cents(b.from)) !==
        (b.to === null ? null : cents(b.to)),
    );
  if (flips.length || balanceChanges.length) {
    const candidate = check(s, after);
    if (rows.some((r) => r.locked && flips.includes(r.id))) {
      fix.skipped = 'a row to flip has splits';
    } else if (
      RANK[candidate.verification] >= RANK[before.verification] &&
      score(candidate) > score(before)
    ) {
      fix.flips = flips;
      fix.balances = balanceChanges.map((b) => ({
        id: b.id,
        balanceAfter: b.to,
      }));
      result = candidate;
      current = after;
    } else {
      fix.skipped = 'the repaired rows do not check out better';
    }
  }

  // 3. A null opening / closing from the running balance (not on a card: the balance it
  // prints is what is OWED, and the chain reads a card's figures its own way).
  if (!isCard(s) && (s.openingBalance === null || s.closingBalance === null)) {
    const derived = balancesFromRunning(current, result);
    if (derived) {
      const opening = s.openingBalance ?? derived.opening;
      const closing = s.closingBalance ?? derived.closing;
      const net = current.reduce((t, r) => t + cents(r.amount), 0);
      if (
        opening !== null &&
        closing !== null &&
        cents(opening) + net === cents(closing)
      ) {
        if (s.openingBalance === null) fix.opening = opening;
        if (s.closingBalance === null) fix.closing = closing;
        result = check(
          { ...s, openingBalance: opening, closingBalance: closing },
          current,
        );
      }
    }
  }

  // 4. The verdict, only ever upwards.
  if (
    (fix.flips.length ||
      fix.balances.length ||
      fix.opening !== undefined ||
      fix.closing !== undefined) &&
    RANK[result.verification] > RANK[s.verification ?? 'UNVERIFIED']
  ) {
    fix.verification = result.verification;
    fix.detail = result.checks.map((c) => ({ ...c, text: describeCheck(c) }));
  }
  return fix;
}

/** Whether a plan changes anything. */
export const changes = (f: StatementFix): boolean =>
  f.flips.length > 0 ||
  f.balances.length > 0 ||
  f.opening !== undefined ||
  f.closing !== undefined ||
  f.verification !== undefined;
