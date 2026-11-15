import { parentSubName, subNameOf } from './sub-names.util';

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
    hasSubSplits: true,
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
        category: 'Office Supplies',
        current: { parent: 'Walmart', category: 'Groceries' },
      }),
    ).toEqual({
      want: { parent: 'Walmart', category: 'Office Supplies' },
      change: true,
    });
  });

  it('loses it when no split has a sub-name any more, or it has no name', () => {
    const current = { parent: 'Walmart', category: 'Groceries' };
    expect(parentSubName({ ...base, hasSubSplits: false, current })).toEqual({
      want: null,
      change: true,
    });
    expect(parentSubName({ ...base, name: null, current }).want).toBeNull();
    expect(
      parentSubName({ ...base, hasSubSplits: false, current: null }).change,
    ).toBe(false);
  });
});
