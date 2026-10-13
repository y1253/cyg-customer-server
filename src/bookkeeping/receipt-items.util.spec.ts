import { itemKey, itemSplits } from './receipt-items.util';

/** The refusal's reason, or '' when it made splits. */
const problemOf = (out: ReturnType<typeof itemSplits>): string =>
  'problem' in out ? out.problem : '';

describe('receipt items → splits', () => {
  const parent = () => 'Office Supplies';

  it('spreads the tax across the items so they add back to the charge', () => {
    // Walmart: 10 + 40 + 30 + 10 = 90 before tax, 10 tax, $100 charged.
    const out = itemSplits(
      [
        { name: 'Tissue', amount: 10 },
        { name: 'Pampers', amount: 40 },
        { name: 'Detergent', amount: 30 },
        { name: 'Soap', amount: 10 },
      ],
      10,
      -100,
      parent,
    );
    if (!('splits' in out)) throw new Error(out.problem);
    expect(out.splits.map((s) => s.amount)).toEqual([
      11.11, 44.44, 33.33, 11.12,
    ]);
    const total = out.splits.reduce(
      (n, s) => n + Math.round(s.amount * 100),
      0,
    );
    expect(total).toBe(10000);
    expect(out.splits.every((s) => s.category === 'Office Supplies')).toBe(
      true,
    );
  });

  it('the last item absorbs the rounding, to the cent', () => {
    const out = itemSplits(
      [
        { name: 'A', amount: 1 },
        { name: 'B', amount: 1 },
        { name: 'C', amount: 1 },
      ],
      0.1,
      -3.1,
      parent,
    );
    if (!('splits' in out)) throw new Error(out.problem);
    expect(out.splits.map((s) => s.amount)).toEqual([1.03, 1.03, 1.04]);
  });

  it('leaves a tip on the parent: items may add up to less than the charge', () => {
    const out = itemSplits([{ name: 'Lunch', amount: 40 }], 5, -54, parent);
    if (!('splits' in out)) throw new Error(out.problem);
    expect(out.splits).toEqual([
      { itemName: 'Lunch', category: 'Office Supplies', amount: 45 },
    ]);
  });

  it('refuses a receipt worth more than the charge', () => {
    const out = itemSplits([{ name: 'TV', amount: 500 }], 50, -100, parent);
    expect(problemOf(out)).toMatch(/more than/);
  });

  it('refuses a receipt with no usable items', () => {
    expect(problemOf(itemSplits([], 0, -10, parent))).toMatch(/No items/);
    expect(
      problemOf(
        itemSplits(
          [
            { name: ' ', amount: 5 },
            { name: 'X', amount: 0 },
          ],
          0,
          -10,
          parent,
        ),
      ),
    ).toMatch(/No items/);
  });

  it('asks for each item its own category (an "Always" rule)', () => {
    const out = itemSplits(
      [
        { name: 'Pampers', amount: 40 },
        { name: 'Tissue', amount: 10 },
      ],
      0,
      -50,
      (n) => (n === 'Pampers' ? 'Supplies' : 'Office Supplies'),
    );
    if (!('splits' in out)) throw new Error(out.problem);
    expect(out.splits.map((s) => s.category)).toEqual([
      'Supplies',
      'Office Supplies',
    ]);
  });

  it('keys an item without sizes and codes', () => {
    expect(itemKey('PAMPERS Size 4 #123')).toBe(itemKey('pampers size'));
  });
});
