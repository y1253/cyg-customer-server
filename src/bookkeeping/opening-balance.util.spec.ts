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

  it('chains past a wrong printed closing when opening + Σ rows matches (TD March, 2026-10-18)', () => {
    // The closing stored on February was its own opening (a per-page figure); the rows prove 1500.
    const td = 'TD Canada Trust 3246';
    expect(
      ids([
        st(1, '2026-02-01', 1000, 1000, td, 500),
        st(2, '2026-03-01', 1500, null, td, -200),
      ]),
    ).toEqual([1]);
  });

  it('chains an overdrawn balance stored without its minus on one side', () => {
    expect(
      ids([
        st(1, '2026-01-01', 100, -1468.82, 'BMO 2222', -1568.82),
        st(2, '2026-02-01', 1468.82, null, 'BMO 2222', 0),
      ]),
    ).toEqual([1]);
  });

  it('still gives the full balance after a real gap', () => {
    const rows = openingRows([
      st(1, '2026-01-01', 1000, 1200, 'Chase 4362', 200),
      st(2, '2026-03-01', 1750, null, 'Chase 4362', 0),
    ]);
    expect(rows.map((r) => [r.statementId, r.amount])).toEqual([
      [1, 1000],
      [2, 1750],
    ]);
  });

  it('bridges statements whose opening was not read (TD 5234 March, 2026-10-19)', () => {
    const td = 'TD Canada Trust 5234';
    expect(
      ids([
        st(133, '2023-12-29', 3392.74, null, td, -4001.16),
        st(134, '2024-01-31', null, null, td, -1652.58),
        st(177, '2024-02-29', null, null, td, 3868.15),
        st(176, '2024-03-28', 1607.15, null, td, -1890.54),
        st(137, '2024-04-30', null, null, td, 2699.33),
        st(138, '2024-05-31', 2415.94, null, td, -1474),
        st(139, '2024-06-28', 941.94, null, td, -2745.32),
        st(140, '2024-07-31', null, null, td, 6196.87),
        st(141, '2024-08-30', 4393.49, null, td, -2942.32),
        // October was deleted → a real gap.
        st(143, '2024-10-31', 3849.57, null, td, -3888.71),
        st(144, '2024-11-29', null, null, td, 1499.35),
      ]),
    ).toEqual([133, 143]);
  });

  it('still adds a row when a bridge does not add up', () => {
    const td = 'TD Canada Trust 5234';
    expect(
      ids([
        st(1, '2024-01-01', 3392.74, null, td, -4001.16),
        st(2, '2024-02-01', null, null, td, -1652.58),
        st(3, '2024-03-01', 2000, null, td, 0),
      ]),
    ).toEqual([1, 3]);
  });

  it('restarts the chain from a statement whose opening was read', () => {
    // 2 is a real gap; 3 continues 2 (2000 + 100). 4 opens at 1's old ending, which no
    // longer counts.
    expect(
      ids([
        st(1, '2026-01-01', 100, null, 'Chase 4362', 50),
        st(2, '2026-02-01', 2000, null, 'Chase 4362', 100),
        st(3, '2026-03-01', 2100, null, 'Chase 4362', 0),
        st(4, '2026-04-01', 150, null, 'Chase 4362', 0),
      ]),
    ).toEqual([1, 2, 4]);
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

  it('posts a credit card balance OWED as a debt on the card', () => {
    // Amex: Previous balance $500 owed → −500 on the card, debit Owner's Loan.
    const [r] = openingRows([
      {
        ...st(1, '2026-01-01', 500, 600, 'Amex 1009'),
        accountKind: 'CREDIT_CARD',
      },
    ]);
    expect(r).toMatchObject({
      bankAccount: 'Amex 1009',
      amount: -500,
      debitAccount: OWNERS_LOAN,
      creditAccount: 'Amex 1009',
    });
  });
});
