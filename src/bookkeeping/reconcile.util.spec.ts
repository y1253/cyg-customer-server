import {
  describeCheck,
  reconcile,
  score,
  type ReconcileRow,
  type StatedFigures,
} from './reconcile.util';

const NONE: StatedFigures = {
  openingBalance: null,
  closingBalance: null,
  totalDeposits: null,
  totalWithdrawals: null,
  depositCount: null,
  withdrawalCount: null,
};

/** A clean statement: opening 1000, +50 Stripe, -20 Walmart, -0.1, +0.3 → closing 1030.20. */
function rows(): ReconcileRow[] {
  return [
    { amount: 50, balanceAfter: 1050, page: 0 },
    { amount: -20, balanceAfter: 1030, page: 0 },
    { amount: -0.1, balanceAfter: 1029.9, page: 1 },
    { amount: 0.3, balanceAfter: 1030.2, page: 1 },
  ];
}
const STATED: StatedFigures = {
  openingBalance: 1000,
  closingBalance: 1030.2,
  totalDeposits: 50.3,
  totalWithdrawals: 20.1,
  depositCount: 2,
  withdrawalCount: 2,
};

describe('reconcile', () => {
  it('VERIFIED when every printed figure matches — in cents, no float drift', () => {
    const r = reconcile(STATED, rows());
    expect(r.verification).toBe('VERIFIED');
    expect(r.checks.map((c) => c.name)).toEqual([
      'deposits',
      'withdrawals',
      'balance',
      'depositCount',
      'withdrawalCount',
      'runningBalance',
    ]);
    expect(r.suspectPages).toEqual([]);
  });

  it('a DROPPED row fails the totals and the running balance names its page', () => {
    const dropped = rows().filter((_, i) => i !== 2); // the -0.10 on page 1
    const r = reconcile(STATED, dropped);
    expect(r.verification).toBe('MISMATCH');
    expect(r.checks.find((c) => c.name === 'withdrawals')).toMatchObject({
      expected: 2010,
      actual: 2000,
      ok: false,
    });
    expect(r.checks.find((c) => c.name === 'withdrawalCount')).toMatchObject({
      expected: 2,
      actual: 1,
      ok: false,
    });
    expect(r.suspectPages).toEqual([1]);
  });

  it('a SIGN flip is caught', () => {
    const flipped = rows();
    flipped[1] = { ...flipped[1], amount: 20 };
    const r = reconcile(STATED, flipped);
    expect(r.verification).toBe('MISMATCH');
    expect(r.suspectPages).toEqual([0]);
  });

  it('accepts withdrawals printed as a negative total', () => {
    expect(
      reconcile({ ...STATED, totalWithdrawals: -20.1 }, rows()).verification,
    ).toBe('VERIFIED');
  });

  it('checks a newest-first statement in reverse', () => {
    // Newest first: the printed balances run backwards through the list.
    const newestFirst = rows().reverse();
    expect(reconcile(STATED, newestFirst).verification).toBe('VERIFIED');
  });

  it('UNVERIFIED — never a pass — when the statement prints nothing to check', () => {
    const bare = rows().map((r) => ({ ...r, balanceAfter: null }));
    expect(reconcile(NONE, bare)).toEqual({
      verification: 'UNVERIFIED',
      checks: [],
      suspectPages: [],
    });
  });

  it('runs only the checks the statement printed', () => {
    const r = reconcile(
      { ...NONE, openingBalance: 1000, closingBalance: 1030.2 },
      rows(),
    );
    expect(r.checks.map((c) => c.name)).toEqual(['balance', 'runningBalance']);
    expect(r.verification).toBe('VERIFIED');
  });

  it('score counts passing checks, so the better of two readings can be kept', () => {
    const good = reconcile(STATED, rows());
    const bad = reconcile(STATED, rows().slice(0, 3));
    expect(score(good)).toBeGreaterThan(score(bad));
  });

  it('describes a mismatch with the exact difference', () => {
    const r = reconcile(
      STATED,
      rows().filter((_, i) => i !== 2),
    );
    const w = r.checks.find((c) => c.name === 'withdrawals')!;
    expect(describeCheck(w)).toBe(
      'Withdrawals: statement $20.10, read $20.00 (off by $0.10)',
    );
  });
});
