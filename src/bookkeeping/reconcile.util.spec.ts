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

  describe('totals that are not "the sum of the rows"', () => {
    it('a credit card (balances = amount OWED) verifies with the sign flipped', () => {
      // Owed 500; a -120 purchase and a +200 payment → owed 420.
      const card: ReconcileRow[] = [
        { amount: -120, balanceAfter: 620, page: 0 },
        { amount: 200, balanceAfter: 420, page: 0 },
      ];
      const r = reconcile(
        { ...NONE, openingBalance: 500, closingBalance: 420 },
        card,
      );
      expect(r.verification).toBe('VERIFIED');
      expect(r.checks.every((c) => c.ok)).toBe(true);
    });

    it("the bank's own figures disagree (one category only) → totals skipped, balance decides", () => {
      // "Checks paid 20.00" copied as the withdrawals total: 1000 + 50.30 − 20 ≠ 1030.20.
      const r = reconcile(
        { ...STATED, totalWithdrawals: 20, withdrawalCount: null },
        rows(),
      );
      expect(r.verification).toBe('VERIFIED');
      const w = r.checks.find((c) => c.name === 'withdrawals')!;
      expect(w.ok).toBe(false);
      expect(w.skipped).toMatch(/count something else/);
      expect(describeCheck(w)).toMatch(/^Withdrawals: not compared/);
    });

    it('every row proven by the running balance → a failing total/count is skipped', () => {
      // A self-consistent summary is not printed (no totals), but a count of "1 deposit" is.
      const r = reconcile(
        {
          ...NONE,
          openingBalance: 1000,
          closingBalance: 1030.2,
          depositCount: 1,
        },
        rows(),
      );
      expect(r.verification).toBe('VERIFIED');
      expect(r.checks.find((c) => c.name === 'depositCount')!.skipped).toMatch(
        /running balance/,
      );
    });

    it('the balance alone is NOT proof: two offsetting misreads still MISMATCH', () => {
      // +5 deposit and −5 withdrawal both missing; net and closing unchanged, no running balance.
      const bare = [
        { amount: 55, balanceAfter: null, page: 0 },
        { amount: -25, balanceAfter: null, page: 0 },
        { amount: -0.1, balanceAfter: null, page: 1 },
        { amount: 0.3, balanceAfter: null, page: 1 },
      ];
      const r = reconcile(
        { ...STATED, depositCount: null, withdrawalCount: null },
        bare,
      );
      expect(r.checks.find((c) => c.name === 'balance')!.ok).toBe(true);
      expect(r.verification).toBe('MISMATCH');
      expect(r.checks.filter((c) => c.skipped)).toEqual([]);
    });

    it('the AI\'s "partial" is believed when nothing proves the totals complete', () => {
      const bare = rows().map((r) => ({ ...r, balanceAfter: null }));
      const r = reconcile(
        { ...NONE, totalWithdrawals: 20, totalsScope: 'partial' },
        bare,
      );
      expect(r.verification).toBe('UNVERIFIED');
      expect(r.checks[0].skipped).toMatch(/does not cover every transaction/);
    });

    it("…but NOT when the bank's own figures prove the totals complete (a dropped row stays caught)", () => {
      const dropped = rows()
        .filter((_, i) => i !== 2)
        .map((r) => ({ ...r, balanceAfter: null }));
      const r = reconcile({ ...STATED, totalsScope: 'partial' }, dropped);
      expect(r.verification).toBe('MISMATCH');
      expect(r.checks.filter((c) => c.skipped)).toEqual([]);
    });

    it('a running balance on every row and nothing else printed → VERIFIED by the chain', () => {
      const r = reconcile(NONE, rows());
      expect(r.checks.map((c) => c.name)).toEqual(['runningBalance']);
      expect(r.verification).toBe('VERIFIED');
    });

    it('a balance printed only on the last row of each day still chains', () => {
      const daily = rows();
      daily[0] = { ...daily[0], balanceAfter: null };
      daily[2] = { ...daily[2], balanceAfter: null };
      const r = reconcile({ ...NONE, openingBalance: 1000 }, daily);
      expect(r.verification).toBe('VERIFIED');
    });
  });
});
