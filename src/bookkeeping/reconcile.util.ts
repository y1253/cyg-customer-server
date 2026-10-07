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
 *
 * ⚠️ Not every printed total is "the sum of the rows": year-to-date figures, one category
 * only ("Checks paid"), totals that leave out fees… Re-reading can never make the rows
 * match those, so a failing total/count check is SKIPPED (with a reason) when the
 * statement shows it measures something else — see `skipReason`. And a credit card
 * prints the balance OWED, so balances are tried with both signs.
 */

/** The figures the bank printed (copied, never computed). Null = not printed. */
export interface StatedFigures {
  openingBalance: number | null;
  closingBalance: number | null;
  totalDeposits: number | null;
  totalWithdrawals: number | null;
  depositCount: number | null;
  withdrawalCount: number | null;
  /**
   * The model's own reading of the summary: do the printed totals cover EVERY transaction
   * ('all'), only some ('partial' — YTD, one category, excludes fees…), or are there none.
   * Trusted only when the bank's figures cannot prove it wrong (`skipReason`).
   */
  totalsScope?: TotalsScope | null;
}

export type TotalsScope = 'all' | 'partial' | 'none';

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
  /**
   * Set when a FAILING check compares against a figure that is not the sum of the rows
   * (why, in words). A skipped check does not count toward the verdict, so the statement
   * is not re-read for a total it can never match.
   */
  skipped: string | null;
  /** 0-based page whose OWN summary box this checks (per-page totals); absent = whole statement. */
  page?: number;
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
  const amounts = rows.map((r) => cents(r.amount));
  const inSum = amounts.filter((a) => a > 0).reduce((s, a) => s + a, 0);
  const outSum = -amounts.filter((a) => a < 0).reduce((s, a) => s + a, 0);
  const net = inSum - outSum;

  // Totals and counts: compared to the rows directly.
  const totals: Check[] = [];
  if (stated.totalDeposits !== null) {
    totals.push(
      check('deposits', cents(Math.abs(stated.totalDeposits)), inSum),
    );
  }
  if (stated.totalWithdrawals !== null) {
    // Banks print withdrawals as a positive total, a negative one, or in brackets.
    totals.push(
      check('withdrawals', cents(Math.abs(stated.totalWithdrawals)), outSum),
    );
  }
  const counts: Check[] = [];
  if (stated.depositCount !== null) {
    const actual = amounts.filter((a) => a > 0).length;
    counts.push(check('depositCount', stated.depositCount, actual));
  }
  if (stated.withdrawalCount !== null) {
    const actual = amounts.filter((a) => a < 0).length;
    counts.push(check('withdrawalCount', stated.withdrawalCount, actual));
  }

  // Balances: as printed, and negated — a credit card prints the balance OWED, so its
  // purchases (negative rows) RAISE the printed balance. Keep the sign that fits better.
  const asPrinted = balanceChecks(stated, rows, amounts, net, 1);
  const owed = balanceChecks(stated, rows, amounts, net, -1);
  const balances = fit(owed) > fit(asPrinted) ? owed : asPrinted;

  const reason = skipReason(stated, balances);
  for (const c of [...totals, ...counts]) {
    if (!c.ok && reason) c.skipped = reason;
  }

  const checks = [
    ...totals,
    ...(balances.balance ? [balances.balance] : []),
    ...counts,
    ...(balances.running ? [balances.running] : []),
  ];
  const suspect = new Set(balances.suspect);
  // The chain holds but the ending balance doesn't: the extra/missing rows come AFTER the
  // last printed balance — e.g. a page of cheque images read as new withdrawals.
  if (balances.balance && !balances.balance.ok && !suspect.size) {
    const last = rows.map((r) => r.balanceAfter !== null).lastIndexOf(true);
    if (last >= 0) rows.slice(last + 1).forEach((r) => suspect.add(r.page));
  }
  return {
    verification: verdict(checks),
    checks,
    suspectPages: [...suspect].sort((a, b) => a - b),
  };
}

function verdict(checks: Check[]): Verification {
  const counted = checks.filter((c) => !c.skipped);
  return !counted.length
    ? 'UNVERIFIED'
    : counted.every((c) => c.ok)
      ? 'VERIFIED'
      : 'MISMATCH';
}

/** One page's own printed figures and the rows read from it. */
export interface PageFigures {
  stated: StatedFigures;
  rows: ReconcileRow[];
}

/**
 * The whole statement, checked. Usually that is `reconcile(stated, allRows)` — but some
 * banks (TD) print a Credits/Debits box on EVERY page that totals only THAT page. Taking
 * page 1's box as the statement's total was a production false alarm ("doesn't match" on a
 * perfectly read statement). Per-page boxes are recognised by pages printing DIFFERENT
 * totals; each page is then checked against its own box, and the balances (opening of the
 * first page, closing of the last) against all rows.
 */
export function reconcileStatement(
  stated: StatedFigures,
  pages: PageFigures[],
): ReconcileResult {
  const allRows = pages.flatMap((p) => p.rows);
  const boxes = pages
    .map((p, page) => ({ ...p, page }))
    .filter(
      (p) =>
        p.stated.totalDeposits !== null || p.stated.totalWithdrawals !== null,
    );
  const key = (f: StatedFigures) =>
    [f.totalDeposits, f.totalWithdrawals, f.depositCount, f.withdrawalCount]
      .map((v) => (v === null ? '' : String(Math.abs(v))))
      .join('|');
  const perPage =
    boxes.length >= 2 && new Set(boxes.map((b) => key(b.stated))).size > 1;
  if (!perPage) return reconcile(stated, allRows);

  const NO_TOTALS = {
    totalDeposits: null,
    totalWithdrawals: null,
    depositCount: null,
    withdrawalCount: null,
    totalsScope: null,
  };
  const whole = reconcile({ ...stated, ...NO_TOTALS }, allRows);
  const pageChecks: Check[] = [];
  const suspect = new Set(whole.suspectPages);
  for (const box of boxes) {
    // The page's own opening ("balance forward") and closing; without a printed closing,
    // its last printed running balance.
    const lastPrinted = [...box.rows]
      .reverse()
      .find((r) => r.balanceAfter !== null);
    const r = reconcile(
      {
        ...box.stated,
        closingBalance:
          box.stated.closingBalance ?? lastPrinted?.balanceAfter ?? null,
      },
      box.rows,
    );
    for (const c of r.checks) {
      if (c.name === 'balance' || c.name === 'runningBalance') continue;
      pageChecks.push({ ...c, page: box.page });
      if (!c.ok && !c.skipped) suspect.add(box.page);
    }
  }
  const checks = [...pageChecks, ...whole.checks];
  return {
    verification: verdict(checks),
    checks,
    suspectPages: [...suspect].sort((a, b) => a - b),
  };
}

const check = (name: CheckName, expected: number, actual: number): Check => ({
  name,
  expected,
  actual,
  ok: expected === actual,
  skipped: null,
});

interface BalanceChecks {
  balance: Check | null;
  running: Check | null;
  suspect: Set<number>;
  /** opening + deposits − withdrawals = closing, on the bank's OWN figures; null = can't tell. */
  selfConsistent: boolean | null;
}

/** Opening + net = closing and the running-balance chain, with balances read as `sign`. */
function balanceChecks(
  stated: StatedFigures,
  rows: ReconcileRow[],
  amounts: number[],
  net: number,
  sign: 1 | -1,
): BalanceChecks {
  const bal = (n: number | null) => (n === null ? null : sign * cents(n));
  const opening = bal(stated.openingBalance);
  const closing = bal(stated.closingBalance);
  const balance =
    opening !== null && closing !== null
      ? check('balance', closing, opening + net)
      : null;

  // Running balance: each printed balance must equal the previous one plus this row. A
  // broken link names its page. Banks list rows oldest-first OR newest-first, so the
  // chain is checked in both orders and the better reading kept.
  const printed = rows.map((r) => bal(r.balanceAfter));
  const pages = rows.map((r) => r.page);
  const forward = runningBalance(printed, amounts, pages, opening);
  const backward = runningBalance(
    [...printed].reverse(),
    [...amounts].reverse(),
    [...pages].reverse(),
    opening,
  );
  const chain =
    backward.links > 0 && backward.broken < forward.broken ? backward : forward;
  const running =
    chain.links > 0
      ? check('runningBalance', chain.links, chain.links - chain.broken)
      : null;

  const dep = stated.totalDeposits;
  const wd = stated.totalWithdrawals;
  const selfConsistent =
    opening !== null && closing !== null && dep !== null && wd !== null
      ? opening + cents(Math.abs(dep)) - cents(Math.abs(wd)) === closing
      : null;
  return { balance, running, suspect: chain.suspect, selfConsistent };
}

/** How well a balance reading fits: passing checks, then fewer broken links, then consistency. */
function fit(b: BalanceChecks): number {
  const passing = (b.balance?.ok ? 1 : 0) + (b.running?.ok ? 1 : 0);
  const broken = b.running ? b.running.expected - b.running.actual : 0;
  return passing * 1e9 + (b.selfConsistent ? 1e6 : 0) - broken;
}

/**
 * Why the printed totals/counts are NOT comparable to the rows — or null when they are, so
 * a failing one really means a misread row. In order:
 *  1. the bank's own figures disagree (opening + deposits − withdrawals ≠ closing): the
 *     totals count something else (YTD, one category…), so the balances decide;
 *  2. every row is proven: the running-balance chain AND opening + net = closing hold.
 *     (The balance alone is no proof — two offsetting misreads pass it.)
 *  3. the model said the totals are partial — believed only when (1) cannot prove them
 *     complete, so "partial" can't be used to hide a dropped row.
 */
function skipReason(stated: StatedFigures, b: BalanceChecks): string | null {
  if (b.selfConsistent === false) {
    return "the statement's totals don't add up to its own opening and closing balance, so they count something else";
  }
  if (b.running?.ok && b.balance?.ok) {
    return "every row matches the bank's running balance, so the printed figure counts something different";
  }
  if (stated.totalsScope === 'partial' && b.selfConsistent !== true) {
    return 'the printed figure does not cover every transaction on the statement';
  }
  return null;
}

function runningBalance(
  printed: Array<number | null>,
  amounts: number[],
  pages: number[],
  opening: number | null,
): { links: number; broken: number; suspect: Set<number> } {
  const suspect = new Set<number>();
  let prev = opening;
  let links = 0;
  let broken = 0;
  printed.forEach((balance, i) => {
    if (balance === null) {
      if (prev !== null) prev += amounts[i];
      return;
    }
    if (prev !== null) {
      links++;
      if (prev + amounts[i] !== balance) {
        broken++;
        suspect.add(pages[i]);
      }
    }
    prev = balance; // re-anchor on what the bank printed, so one bad row is one failure
  });
  return { links, broken, suspect };
}

/** How many checks pass — used to keep the better of two readings of a page. */
export const score = (r: ReconcileResult): number =>
  r.checks.filter((c) => c.ok && !c.skipped).length;

const CHECK_LABEL: Record<CheckName, string> = {
  deposits: 'Deposits',
  withdrawals: 'Withdrawals',
  balance: 'Ending balance',
  depositCount: 'Number of deposits',
  withdrawalCount: 'Number of withdrawals',
  runningBalance: 'Running balance',
};

/** "Withdrawals: statement $4,812.40, read $4,728.03 (off by $84.37)" — for prompts and the UI. */
export function describeCheck(c: Check): string {
  const text = describe(c);
  return c.page === undefined ? text : `Page ${c.page + 1} — ${text}`;
}

function describe(c: Check): string {
  if (c.skipped) return `${CHECK_LABEL[c.name]}: not compared — ${c.skipped}`;
  const money = (v: number) =>
    `${v < 0 ? '-' : ''}$${(Math.abs(v) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
