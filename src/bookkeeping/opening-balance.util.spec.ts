import { OWNERS_LOAN } from './chart-of-accounts';
import { openingRows, type OpeningStatement } from './opening-balance.util';

const st = (
  id: number,
  periodStart: string | null,
  openingBalance: number | null,
  closingBalance: number | null,
  accountName: string | null = 'Chase 4362',
  net = 0,
): OpeningStatement => ({
  id,
  accountName,
  openingBalance,
  closingBalance,
  net,
  periodStart: periodStart ? new Date(`${periodStart}T00:00:00Z`) : null,
});

const ids = (s: OpeningStatement[]) => openingRows(s).map((r) => r.statementId);

describe('openingRows', () => {
  it('gives the first statement a Starting balance row offset to Owner’s Loan', () => {
    const [r] = openingRows([st(1, '2026-01-01', 1000, 1200)]);
    expect(r).toMatchObject({
      statementId: 1,
      bankAccount: 'Chase 4362',
      amount: 1000,
      description: 'Starting balance',
      offsetAccount: OWNERS_LOAN,
      debitAccount: 'Chase 4362',
      creditAccount: OWNERS_LOAN,
    });
    expect(r.postingDate?.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('skips a statement that continues the previous one of the same account', () => {
    expect(
      ids([
        st(1, '2026-01-01', 1000, 1200.1),
        st(2, '2026-02-01', 1200.1, 900),
      ]),
    ).toEqual([1]);
  });

  it('gives the full balance after a gap or mismatch', () => {
    const rows = openingRows([
      st(1, '2026-01-01', 100, 200),
      st(2, '2026-03-01', 500, 600),
    ]);
    expect(rows.map((r) => [r.statementId, r.amount])).toEqual([
      [1, 100],
      [2, 500],
    ]);
  });

  it('chains each account on its own', () => {
    expect(
      ids([
        st(1, '2026-01-01', 100, 200, 'Chase 4362'),
        st(2, '2026-02-01', 200, 300, 'TD 1111'),
      ]),
    ).toEqual([1, 2]);
  });

  it('sorts by period, not by upload order', () => {
    expect(
      ids([st(9, '2026-02-01', 200, 300), st(3, '2026-01-01', 100, 200)]),
    ).toEqual([3]);
  });

  it('adds no row for a missing or zero opening balance', () => {
    expect(
      ids([st(1, '2026-01-01', null, 200), st(2, '2026-05-01', 0, 50)]),
    ).toEqual([]);
  });

  it('chains statements that print no closing balance via opening + Σ rows (production TD case)', () => {
    // Uploaded June first, then May; neither printed a closing balance.
    const td = 'TD Canada Trust 3246';
    expect(
      ids([
        st(14, '2026-05-29', 12629.94, null, td, -7539.12),
        st(15, '2026-04-30', 6114, null, td, 6515.94),
      ]),
    ).toEqual([15]);
  });

  it('chains a credit card, whose printed balance is the amount owed', () => {
    // Owed 500, charged 200 (−200 from the bank side) → owes 700 next month.
    expect(
      ids([
        st(1, '2026-01-01', 500, null, 'Visa 1111', -200),
        st(2, '2026-02-01', 700, null, 'Visa 1111', 50),
      ]),
    ).toEqual([1]);
  });

  it('still adds a row when the computed ending does not match', () => {
    expect(
      ids([
        st(1, '2026-01-01', 100, null, 'Chase 4362', 50),
        st(2, '2026-02-01', 400, null, 'Chase 4362', 0),
      ]),
    ).toEqual([1, 2]);
  });

  it('posts a negative balance as money out of the bank', () => {
    const [r] = openingRows([st(1, '2026-01-01', -50, 0, null)]);
    expect(r).toMatchObject({
      bankAccount: 'Bank account',
      amount: -50,
      debitAccount: OWNERS_LOAN,
      creditAccount: 'Bank account',
    });
  });
});
