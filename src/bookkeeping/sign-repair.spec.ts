import {
  repairBalanceSigns,
  repairSigns,
  repairSignsFromTotals,
  segmentSigns,
} from './sign-repair';

/** A TD-style day: balance printed only on the day's last row. Opening 1000. */
const day = [
  { amount: 100, balanceAfter: null },
  { amount: -50, balanceAfter: null },
  { amount: 200, balanceAfter: 1250 },
  { amount: -100, balanceAfter: 1150 },
];

describe('repairSigns', () => {
  it('leaves a reading whose signs already fit alone', () => {
    expect(repairSigns(day, 1000)).toEqual({
      amounts: [100, -50, 200, -100],
      flips: 0,
    });
  });

  it('fixes amounts put in the wrong column, from the balance printed at the end of the day', () => {
    const misread = day.map((r, i) =>
      i === 1 || i === 3 ? { ...r, amount: -r.amount } : r,
    );
    expect(repairSigns(misread, 1000)).toEqual({
      amounts: [100, -50, 200, -100],
      flips: 2,
    });
  });

  it('never guesses: two equal amounts that could swap signs are left as read', () => {
    // +30 +30 must net to 0 — either one could be the withdrawal.
    expect(segmentSigns([3000, 3000], 0)).toBeNull();
    const rows = [
      { amount: 30, balanceAfter: null },
      { amount: 30, balanceAfter: 1000 },
    ];
    expect(repairSigns(rows, 1000).flips).toBe(0);
  });

  it('a segment no sign choice can explain (a missing row) is left alone', () => {
    expect(segmentSigns([5000], 2500)).toBeNull();
  });

  it('handles newest-first statements', () => {
    const newestFirst = [
      { amount: 100, balanceAfter: 1150 }, // misread: really −100
      { amount: 200, balanceAfter: 1250 },
      { amount: -50, balanceAfter: null },
      { amount: 100, balanceAfter: null },
    ];
    expect(repairSigns(newestFirst, 1000).amounts).toEqual([
      -100, 200, -50, 100,
    ]);
  });

  it('does not "repair" a credit card, whose printed balance is the amount OWED', () => {
    // Owed 500; a −120 purchase raises it to 620, a +200 payment lowers it to 420.
    const card = [
      { amount: -120, balanceAfter: 620 },
      { amount: 200, balanceAfter: 420 },
    ];
    expect(repairSigns(card, 500)).toEqual({ amounts: [-120, 200], flips: 0 });
  });
});

describe('repairBalanceSigns', () => {
  it('puts back the minus of an overdrawn balance (2-2024.pdf, production 2026-10-14)', () => {
    // The bank printed "1,468.82-"; the model read 1468.82. That broke two links.
    const rows = [
      { amount: -1.5, balanceAfter: 3028.78 },
      { amount: -1448.8, balanceAfter: null },
      { amount: -1448.8, balanceAfter: null },
      { amount: -1600, balanceAfter: 1468.82 },
      ...[39.2, 1500, 89.6, 1000, -1000, -1.5, 1316.4, -1000, 2000, -1000].map(
        (amount) => ({ amount, balanceAfter: null }),
      ),
      { amount: -5, balanceAfter: 1469.88 },
      { amount: 370.72, balanceAfter: null },
      { amount: -800, balanceAfter: 1040.6 },
    ];
    const out = repairBalanceSigns(rows, null);
    expect(out.fixes).toBe(1);
    expect(out.balances[3]).toBe(-1468.82);
    expect(out.balances.filter((b) => b !== null)).toEqual([
      3028.78, -1468.82, 1469.88, 1040.6,
    ]);
  });

  it('fixes the FIRST balance when no opening is printed and its negative is what fits', () => {
    const out = repairBalanceSigns(
      [
        { amount: -100, balanceAfter: 50 }, // really -50
        { amount: 200, balanceAfter: 150 },
        { amount: -30, balanceAfter: 120 },
        { amount: 10, balanceAfter: 130 },
      ],
      null,
    );
    expect(out).toEqual({ balances: [-50, 150, 120, 130], fixes: 1 });
  });

  it('leaves the balances alone when it is a ROW that is wrong', () => {
    const rows = [
      { amount: -10, balanceAfter: 90 },
      { amount: -25, balanceAfter: 70 }, // really -20
    ];
    expect(repairBalanceSigns(rows, 100)).toEqual({
      balances: [90, 70],
      fixes: 0,
    });
  });
});

describe('repairSignsFromTotals', () => {
  const rows = (...a: number[]) => a.map((amount) => ({ amount }));
  const totals = (
    deposits: number | null,
    withdrawals: number | null,
    depositCount: number | null = null,
    withdrawalCount: number | null = null,
  ) => ({ deposits, withdrawals, depositCount, withdrawalCount });

  it('flips the one set of rows the box asks for', () => {
    const fix = repairSignsFromTotals(
      rows(20, 100, 200, -5),
      totals(20, 305, 1, 3),
    );
    expect(fix).toEqual({ amounts: [20, -100, -200, -5], flips: 2 });
  });

  it('works the other way (a deposit read as a withdrawal)', () => {
    const fix = repairSignsFromTotals(rows(-40, -10), totals(40, 10));
    expect(fix).toEqual({ amounts: [40, -10], flips: 1 });
  });

  it('leaves an ambiguous choice alone', () => {
    const fix = repairSignsFromTotals(rows(50, 50, 10), totals(60, 50));
    expect(fix.flips).toBe(0);
  });

  it('leaves it alone when the counts disagree after the flip', () => {
    const fix = repairSignsFromTotals(rows(20, 100), totals(20, 100, 1, 2));
    expect(fix.flips).toBe(0);
  });

  it('leaves a misread AMOUNT alone (totals off by different amounts)', () => {
    const fix = repairSignsFromTotals(rows(20, 100), totals(20, 90));
    expect(fix.flips).toBe(0);
  });

  it('needs both totals', () => {
    expect(repairSignsFromTotals(rows(20, 100), totals(20, null)).flips).toBe(
      0,
    );
  });
});
