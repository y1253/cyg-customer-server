/**
 * Checks extracted rows against the bank's OWN figures before a customer sees them.
 *
 * Measured, not hypothetical: reading 3 pages per request, gpt-4o silently dropped 27 of
 * 125 rows and the output looked perfectly plausible. A statement prints its own totals,
 * so a dropped, doubled, misread or sign-flipped row shows up as a number that does not
 * add up — and the running-balance column points at the page it happened on.
 *
 * PURE: all arithmetic in integer cents. A check runs only when the statement printed
 * what it needs; with nothing printed at all the result is UNVERIFIED (nothing to check
 * against), never a pass.
 */

/** The figures the bank printed (copied, never computed). Null = not printed. */
export interface StatedFigures {
  openingBalance: number | null;
  closingBalance: number | null;
  totalDeposits: number | null;
  totalWithdrawals: number | null;
  depositCount: number | null;
  withdrawalCount: number | null;
}

export interface ReconcileRow {
  /** Signed: > 0 money in, < 0 money out. */
  amount: number;
  /** Running balance printed after this row, if any. */
  balanceAfter: number | null;
  /** 0-based page the row was read from. */
  page: number;
}

export type CheckName =
  | 'deposits'
  | 'withdrawals'
  | 'balance'
  | 'depositCount'
  | 'withdrawalCount'
  | 'runningBalance';

export interface Check {
  name: CheckName;
  /** What the bank printed (cents for money, a count for counts). */
  expected: number;
  /** What the extracted rows add up to. */
  actual: number;
  ok: boolean;
}

export type Verification = 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH';

export interface ReconcileResult {
  verification: Verification;
  checks: Check[];
  /** Pages the running balance says are wrong; empty = unknown (re-read them all). */
  suspectPages: number[];
}

export const cents = (n: number): number => Math.round(n * 100);

export function reconcile(
  stated: StatedFigures,
  rows: ReconcileRow[],
): ReconcileResult {
  const checks: Check[] = [];
  const amounts = rows.map((r) => cents(r.amount));
  const inSum = amounts.filter((a) => a > 0).reduce((s, a) => s + a, 0);
  const outSum = -amounts.filter((a) => a < 0).reduce((s, a) => s + a, 0);
  const net = inSum - outSum;

  if (stated.totalDeposits !== null) {
    const expected = cents(Math.abs(stated.totalDeposits));
    checks.push({
      name: 'deposits',
      expected,
      actual: inSum,
      ok: expected === inSum,
    });
  }
  if (stated.totalWithdrawals !== null) {
    // Banks print withdrawals as a positive total, a negative one, or in brackets.
    const expected = cents(Math.abs(stated.totalWithdrawals));
    checks.push({
      name: 'withdrawals',
      expected,
      actual: outSum,
      ok: expected === outSum,
    });
  }
  if (stated.openingBalance !== null && stated.closingBalance !== null) {
    const expected = cents(stated.closingBalance);
    const actual = cents(stated.openingBalance) + net;
    checks.push({ name: 'balance', expected, actual, ok: expected === actual });
  }
  if (stated.depositCount !== null) {
    const actual = amounts.filter((a) => a > 0).length;
    checks.push({
      name: 'depositCount',
      expected: stated.depositCount,
      actual,
      ok: actual === stated.depositCount,
    });
  }
  if (stated.withdrawalCount !== null) {
    const actual = amounts.filter((a) => a < 0).length;
    checks.push({
      name: 'withdrawalCount',
      expected: stated.withdrawalCount,
      actual,
      ok: actual === stated.withdrawalCount,
    });
  }

  // Running balance: each printed balance must equal the previous one plus this row. A
  // broken link names its page. Banks list rows oldest-first OR newest-first, so the
  // chain is checked in both orders and the better reading kept.
  const forward = runningBalance(rows, amounts, stated.openingBalance);
  const backward = runningBalance(
    [...rows].reverse(),
    [...amounts].reverse(),
    stated.openingBalance,
  );
  const chain =
    backward.links > 0 && backward.broken < forward.broken ? backward : forward;
  if (chain.links > 0) {
    checks.push({
      name: 'runningBalance',
      expected: chain.links,
      actual: chain.links - chain.broken,
      ok: chain.broken === 0,
    });
  }
  const suspect = chain.suspect;

  const verification: Verification = !checks.length
    ? 'UNVERIFIED'
    : checks.every((c) => c.ok)
      ? 'VERIFIED'
      : 'MISMATCH';
  return {
    verification,
    checks,
    suspectPages: [...suspect].sort((a, b) => a - b),
  };
}

function runningBalance(
  rows: ReconcileRow[],
  amounts: number[],
  opening: number | null,
): { links: number; broken: number; suspect: Set<number> } {
  const suspect = new Set<number>();
  let prev: number | null = opening !== null ? cents(opening) : null;
  let links = 0;
  let broken = 0;
  rows.forEach((r, i) => {
    if (r.balanceAfter === null) {
      if (prev !== null) prev += amounts[i];
      return;
    }
    const printed = cents(r.balanceAfter);
    if (prev !== null) {
      links++;
      if (prev + amounts[i] !== printed) {
        broken++;
        suspect.add(r.page);
      }
    }
    prev = printed; // re-anchor on what the bank printed, so one bad row is one failure
  });
  return { links, broken, suspect };
}

/** How many checks pass — used to keep the better of two readings of a page. */
export const score = (r: ReconcileResult): number =>
  r.checks.filter((c) => c.ok).length;

/** "Withdrawals: statement $4,812.40, read $4,728.03 (off by $84.37)" — for prompts and the UI. */
export function describeCheck(c: Check): string {
  const money = (v: number) =>
    `$${(v / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  switch (c.name) {
    case 'deposits':
    case 'withdrawals':
    case 'balance': {
      const label =
        c.name === 'balance'
          ? 'Ending balance'
          : c.name === 'deposits'
            ? 'Deposits'
            : 'Withdrawals';
      return c.ok
        ? `${label} ${money(c.expected)} ✓`
        : `${label}: statement ${money(c.expected)}, read ${money(c.actual)} (off by ${money(Math.abs(c.expected - c.actual))})`;
    }
    case 'depositCount':
    case 'withdrawalCount': {
      const label = c.name === 'depositCount' ? 'deposits' : 'withdrawals';
      return c.ok
        ? `${c.expected} ${label} ✓`
        : `Number of ${label}: statement ${c.expected}, read ${c.actual}`;
    }
    case 'runningBalance':
      return c.ok
        ? 'Running balance ✓'
        : `Running balance breaks on ${c.expected - c.actual} of ${c.expected} rows`;
  }
}
