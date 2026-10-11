import {
  remainderOf,
  signedLike,
  splitProblem,
  splitTotals,
} from './splits.util';

describe('hand-made splits', () => {
  const rows = [
    { id: 1, splitOfId: null, amount: -100 },
    { id: 2, splitOfId: 1, amount: -30.1 },
    { id: 3, splitOfId: 1, amount: -19.9 },
    { id: 4, splitOfId: null, amount: 50 },
  ];
  const totals = splitTotals(rows);

  it('a parent keeps what is left after its splits, in exact cents', () => {
    expect(remainderOf(rows[0], totals)).toBe(-50);
    expect(remainderOf(rows[1], totals)).toBe(-30.1);
    expect(remainderOf(rows[3], totals)).toBe(50);
  });

  it('splits may add up to the whole transaction, never more', () => {
    expect(splitProblem(-100, [30, 70])).toBeNull();
    expect(splitProblem(-100, [60, 40.01])).toMatch(/more than/);
    expect(splitProblem(100, [0])).toMatch(/above \$0\.00/);
    expect(splitProblem(100, [1.005])).toMatch(/2 decimals/);
    expect(splitProblem(0, [1])).toMatch(/cannot be split/);
  });

  it('a split takes the sign of its transaction', () => {
    expect(signedLike(-100, 30)).toBe(-30);
    expect(signedLike(100, 30)).toBe(30);
  });
});
