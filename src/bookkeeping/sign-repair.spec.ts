import { repairSigns, segmentSigns } from './sign-repair';

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
