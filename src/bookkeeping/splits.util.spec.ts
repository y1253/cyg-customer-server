import {
  childSplitProblem,
  remainderOf,
  signedLike,
  splitProblem,
  splitTotals,
  splitTree,
  subtreeIds,
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
    // step2 (2026-11-15): a new split starts at $0.00.
    expect(splitProblem(100, [0, 0, 100])).toBeNull();
    expect(splitProblem(100, [-1])).toMatch(/negative/);
    expect(splitProblem(100, [1.005])).toMatch(/2 decimals/);
    expect(splitProblem(0, [1])).toMatch(/cannot be split/);
  });

  it('a split takes the sign of its transaction', () => {
    expect(signedLike(-100, 30)).toBe(-30);
    expect(signedLike(100, 30)).toBe(30);
  });
});

describe('splits of splits (step9, 2026-11-17)', () => {
  const family = [
    { id: 10, parentSplitId: null },
    { id: 11, parentSplitId: 10 },
    { id: 12, parentSplitId: 11 },
    { id: 13, parentSplitId: null },
    { id: 14, parentSplitId: 10 },
  ];

  it('a split and everything cut from it', () => {
    expect(subtreeIds(family, 10)).toEqual([10, 11, 12, 14]);
    expect(subtreeIds(family, 13)).toEqual([13]);
  });

  it('reads each split straight after the one it was cut from', () => {
    expect(splitTree(family).map((t) => [t.row.id, t.depth])).toEqual([
      [10, 0],
      [11, 1],
      [12, 2],
      [14, 1],
      [13, 0],
    ]);
  });

  it('a split whose parent is gone counts as cut from the transaction', () => {
    expect(
      splitTree([{ id: 5, parentSplitId: 99 }]).map((t) => t.depth),
    ).toEqual([0]);
  });

  it('a child takes no more than its split has left', () => {
    expect(childSplitProblem(90, 20, 'Office')).toBeNull();
    expect(childSplitProblem(90, 90, 'Office')).toBeNull();
    expect(childSplitProblem(90, 90.01, 'Office')).toMatch(
      /more than “Office”/,
    );
    expect(childSplitProblem(90, -1, 'Office')).toMatch(/negative/);
  });
});
