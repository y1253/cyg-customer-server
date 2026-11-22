import {
  parentSubName,
  splitLabelOf,
  splitSubNameOf,
  subNameFiling,
  subNameOf,
} from './sub-names.util';

describe('subNameOf', () => {
  it('"<parent> - <category>"', () => {
    expect(subNameOf('Walmart', 'Repairs & Maintenance')).toBe(
      'Walmart - Repairs & Maintenance',
    );
  });
});

describe('parentSubName (step9)', () => {
  const base = {
    name: 'Walmart',
    category: 'Groceries',
    hasSplits: true,
    current: null,
  };

  it('a transaction with a sub-named split gets "<name> - <its category>"', () => {
    expect(parentSubName(base)).toEqual({
      want: { parent: 'Walmart', category: 'Groceries' },
      change: true,
    });
  });

  it('no change when it already has it (name case-insensitive)', () => {
    expect(
      parentSubName({
        ...base,
        current: { parent: 'WALMART', category: 'Groceries' },
      }).change,
    ).toBe(false);
  });

  it('follows its category', () => {
    expect(
      parentSubName({
        ...base,
        category: 'Office Expense',
        current: { parent: 'Walmart', category: 'Groceries' },
      }),
    ).toEqual({
      want: { parent: 'Walmart', category: 'Office Expense' },
      change: true,
    });
  });

  it('loses it when no split has a sub-name any more, or it has no name', () => {
    const current = { parent: 'Walmart', category: 'Groceries' };
    expect(parentSubName({ ...base, hasSplits: false, current })).toEqual({
      want: null,
      change: true,
    });
    expect(parentSubName({ ...base, name: null, current }).want).toBeNull();
    expect(
      parentSubName({ ...base, hasSplits: false, current: null }).change,
    ).toBe(false);
  });
});

describe('parentSubName — a sub-name its description rule gave (step9, 2026-11-17)', () => {
  const current = { parent: 'Walmart', category: 'Office Expense' };

  it('is kept on a row with no sub-named split', () => {
    expect(
      parentSubName({
        name: 'Walmart',
        category: 'Office Expense',
        hasSplits: false,
        current,
        fromRule: true,
      }),
    ).toEqual({ want: current, change: false });
  });

  it('goes when no rule gave it', () => {
    expect(
      parentSubName({
        name: 'Walmart',
        category: 'Office Expense',
        hasSplits: false,
        current,
      }).want,
    ).toBeNull();
  });
});

describe('parentSubName — any split, a wrapper name (step9, 2026-11-17, second request)', () => {
  it('a split left in the same category names the transaction at once', () => {
    expect(
      parentSubName({
        name: 'Walmart',
        category: 'Office Expense',
        hasSplits: true,
        current: null,
      }).want,
    ).toEqual({ parent: 'Walmart', category: 'Office Expense' });
  });

  it('an unsplit row of a wrapper name keeps its sub-name', () => {
    const current = { parent: 'Walmart', category: 'Office Expense' };
    expect(
      parentSubName({
        name: 'Walmart',
        category: 'Office Expense',
        hasSplits: false,
        nameHasSubs: true,
        current,
      }),
    ).toEqual({ want: current, change: false });
  });
});

describe('subNameFiling (step9, 2026-11-17, second request)', () => {
  const wrappers = new Map([['walmart', 1]]);
  const subs = new Map([
    [5, { nameId: 1, category: 'Office Expense' }],
    [6, { nameId: 2, category: 'Office Expense' }],
  ]);
  const row = (
    id: number,
    name: string | null,
    category: string,
    subNameId: number | null,
  ) => ({
    id,
    name,
    category,
    subNameId,
  });

  it('files every row of a wrapper name under its category, leaves the rest', () => {
    expect(
      subNameFiling(
        [
          row(1, 'Walmart', 'Office Expense', 5), // already there
          row(2, ' WALMART ', 'Supplies', null), // none yet
          row(3, 'Walmart', 'Supplies', 5), // its category changed
          row(4, 'Walmart', 'Office Expense', 6), // another name's sub-name
          row(5, 'Target', 'Supplies', null), // not a wrapper
          row(6, null, 'Uncategorized', null),
        ],
        wrappers,
        subs,
      ),
    ).toEqual([
      { id: 2, name: 'WALMART', category: 'Supplies' },
      { id: 3, name: 'Walmart', category: 'Supplies' },
      { id: 4, name: 'Walmart', category: 'Office Expense' },
    ]);
  });
});

describe('splitSubNameOf / splitLabelOf (step12: one-time split sub-names)', () => {
  it('names the piece by its name, category and group or rule', () => {
    expect(splitSubNameOf('Amazon', 'GST', 'Quebec taxes')).toBe(
      'Amazon - GST - Quebec taxes',
    );
    // A rule with no category posts to its own name: the label is not repeated.
    expect(splitSubNameOf('Amazon', 'GST', 'gst')).toBe('Amazon - GST');
  });

  it('reads the label back, for a rename of the parent or the category', () => {
    expect(
      splitLabelOf('Amazon - GST - Quebec taxes', 'Amazon', 'GST'),
    ).toBe('Quebec taxes');
    expect(splitLabelOf('My own name', 'Amazon', 'GST')).toBe('GST');
  });
});
