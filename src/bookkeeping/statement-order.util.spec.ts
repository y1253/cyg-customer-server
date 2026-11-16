import {
  balanceDirection,
  chronological,
  runsNewestFirst,
} from './statement-order.util';

describe('runsNewestFirst', () => {
  it('oldest first', () => {
    expect(
      runsNewestFirst([
        { postingDate: '2026-01-01' },
        { postingDate: '2026-01-02' },
        { postingDate: '2026-01-05' },
      ]),
    ).toBe(false);
  });

  it('newest first', () => {
    expect(
      runsNewestFirst([
        { postingDate: '2026-01-05' },
        { postingDate: '2026-01-02' },
        { postingDate: '2026-01-01' },
      ]),
    ).toBe(true);
  });

  it('counts every step, not only the first and last row', () => {
    // Starts and ends on the same day; the first-vs-last rule called it oldest first.
    expect(
      runsNewestFirst([
        { postingDate: '2026-01-05' },
        { postingDate: '2026-01-04' },
        { postingDate: '2026-01-03' },
        { postingDate: '2026-01-05' },
      ]),
    ).toBe(true);
  });

  it('all on one day: the running balance decides', () => {
    // Newest first: 70 is after paying 30 out of 100.
    expect(
      runsNewestFirst([
        { postingDate: '2026-01-01', amount: -30, balanceAfter: 70 },
        { postingDate: '2026-01-01', amount: 100, balanceAfter: 100 },
      ]),
    ).toBe(true);
    expect(
      runsNewestFirst([
        { postingDate: '2026-01-01', amount: 100, balanceAfter: 100 },
        { postingDate: '2026-01-01', amount: -30, balanceAfter: 70 },
      ]),
    ).toBe(false);
  });

  it('no dates and no balances: printed order', () => {
    expect(runsNewestFirst([{ amount: 1 }, { amount: 2 }])).toBe(false);
    expect(runsNewestFirst([])).toBe(false);
  });
});

describe('chronological', () => {
  it('reverses a newest-first statement, same-day rows included', () => {
    const rows = [
      { postingDate: '2026-01-02', amount: -5, balanceAfter: 95 },
      { postingDate: '2026-01-01', amount: -20, balanceAfter: 100 },
      { postingDate: '2026-01-01', amount: 120, balanceAfter: 120 },
    ];
    expect(chronological(rows).map((r) => r.balanceAfter)).toEqual([
      120, 100, 95,
    ]);
  });

  it('sorts a statement printed in two directions by date (BMO #146)', () => {
    const rows = [
      { postingDate: '2024-08-07', amount: -1 },
      { postingDate: '2024-08-02', amount: -2 },
      { postingDate: '2024-07-22', amount: -3 },
      { postingDate: '2024-07-15', amount: -4 },
      { postingDate: '2024-08-09', amount: -5 },
      { postingDate: '2024-08-14', amount: -6 },
    ];
    expect(chronological(rows).map((r) => r.postingDate)).toEqual([
      '2024-07-15',
      '2024-07-22',
      '2024-08-02',
      '2024-08-07',
      '2024-08-09',
      '2024-08-14',
    ]);
  });

  it('a row with no date stays after the row before it', () => {
    const rows = [
      { postingDate: '2026-01-03', amount: 3 },
      { postingDate: null, amount: 9 },
      { postingDate: '2026-01-01', amount: 1 },
    ];
    expect(chronological(rows).map((r) => r.amount)).toEqual([1, 9, 3]);
  });

  it('leaves an oldest-first statement as it is', () => {
    const rows = [{ postingDate: '2026-01-01' }, { postingDate: '2026-01-02' }];
    expect(chronological(rows)).toBe(rows);
  });
});

describe('balanceDirection', () => {
  it('a bank: balance + amount', () => {
    expect(
      balanceDirection([
        { amount: 100, balanceAfter: 100 },
        { amount: -30, balanceAfter: 70 },
      ]),
    ).toBe(1);
  });

  it('a card printing what is owed: balance − amount', () => {
    expect(
      balanceDirection([
        { amount: -100, balanceAfter: 100 },
        { amount: -30, balanceAfter: 130 },
      ]),
    ).toBe(-1);
  });

  it('a tie falls back on the account kind', () => {
    expect(balanceDirection([{ amount: 1, balanceAfter: 1 }])).toBe(1);
    expect(balanceDirection([{ amount: 1, balanceAfter: 1 }], true)).toBe(-1);
  });
});
