import { OWNERS_LOAN } from './chart-of-accounts';
import { openingRows, type OpeningStatement } from './opening-balance.util';

const st = (
  id: number,
  periodStart: string | null,
  openingBalance: number | null,
  closingBalance: number | null,
  accountName: string | null = 'Chase 4362',
): OpeningStatement => ({
  id,
  accountName,
  openingBalance,
  closingBalance,
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

  it('treats a previous statement with no closing balance as not connected', () => {
    expect(
      ids([st(1, '2026-01-01', 100, null), st(2, '2026-02-01', 200, 300)]),
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
