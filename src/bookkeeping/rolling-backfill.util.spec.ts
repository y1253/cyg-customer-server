import {
  changes,
  planStatementFix,
  type StoredStatement,
} from './rolling-backfill.util';

const stmt = (over: Partial<StoredStatement> = {}): StoredStatement => ({
  openingBalance: 1000,
  closingBalance: 1150,
  statedDeposits: null,
  statedWithdrawals: null,
  statedDepositCount: null,
  statedWithdrawalCount: null,
  verification: 'MISMATCH',
  accountKind: 'BANK',
  ...over,
});

const row = (
  id: number,
  amount: number,
  balanceAfter: number | null,
  locked = false,
) => ({ id, amount, balanceAfter, postingDate: '2021-12-01', locked });

describe('planStatementFix — the one-time rolling backfill (2026-11-25)', () => {
  it('flips a row the running balance proves was read with the wrong sign', () => {
    const fix = planStatementFix(stmt(), [
      row(1, 100, 1100),
      row(2, 50, 1050), // really −50
      row(3, 100, 1150),
    ]);
    expect(fix.flips).toEqual([2]);
    expect(fix.verification).toBe('VERIFIED');
  });

  it('changes nothing on a statement that already checks out', () => {
    const fix = planStatementFix(stmt({ verification: 'VERIFIED' }), [
      row(1, 100, 1100),
      row(2, -50, 1050),
      row(3, 100, 1150),
    ]);
    expect(changes(fix)).toBe(false);
  });

  it('never guesses between two equal rows (TD 4051 #207: two −6.90, one is +6.90)', () => {
    const fix = planStatementFix(
      stmt({
        openingBalance: null,
        closingBalance: null,
        statedDeposits: 13.8,
        statedWithdrawals: 6.9,
        statedDepositCount: 2,
        statedWithdrawalCount: 1,
        verification: 'VERIFIED',
      }),
      [row(1, 6.9, null), row(2, -6.9, null), row(3, -6.9, null)],
    );
    expect(changes(fix)).toBe(false);
  });

  it('repairs a unique flip from totals that cover every row', () => {
    const fix = planStatementFix(
      stmt({
        openingBalance: null,
        closingBalance: null,
        statedDeposits: 107.25,
        statedWithdrawals: 6.9,
        statedDepositCount: 2,
        statedWithdrawalCount: 1,
        verification: 'MISMATCH',
      }),
      [row(1, -7.25, null), row(2, -6.9, null), row(3, 100, null)],
    );
    expect(fix.flips).toEqual([1]);
    expect(fix.verification).toBe('VERIFIED');
  });

  it('works out a closing the bank never printed from the running balance', () => {
    const fix = planStatementFix(
      stmt({ closingBalance: null, verification: 'VERIFIED' }),
      [row(1, 100, 1100), row(2, -50, 1050), row(3, 100, 1150)],
    );
    expect(fix.flips).toEqual([]);
    expect(fix.closing).toBe(1150);
  });

  it('never fills the balances of a card', () => {
    const fix = planStatementFix(
      stmt({
        closingBalance: null,
        verification: 'VERIFIED',
        accountKind: 'CREDIT_CARD',
      }),
      [row(1, 100, 1100), row(2, -50, 1050), row(3, 100, 1150)],
    );
    expect(fix.closing).toBeUndefined();
  });

  it('never flips a row that has splits — that statement is left to a re-read', () => {
    const fix = planStatementFix(stmt(), [
      row(1, 100, 1100),
      row(2, 50, 1050, true),
      row(3, 100, 1150),
    ]);
    expect(fix.flips).toEqual([]);
    expect(fix.skipped).toBe('a row to flip has splits');
  });
});
