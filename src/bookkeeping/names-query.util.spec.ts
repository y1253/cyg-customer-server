import {
  filterNames,
  groupCounts,
  pageOfNames,
  pickSubs,
  subsByParent,
} from './names-query.util';
import type { NameView } from './tax.service';
import type { SubNameView } from './sub-names.service';

const name = (n: string, extra: Partial<NameView> = {}): NameView =>
  ({
    name: n,
    category: 'Office Expense',
    type: 'SUPPLIER',
    group: 'SUPPLIER',
    descriptions: [],
    ...extra,
  }) as NameView;

const sub = (id: number, parent: string, n: string): SubNameView =>
  ({ id, parent, name: n, category: 'Rent' }) as SubNameView;

const view = {
  names: [
    name('Acme', { group: 'CUSTOMER', type: 'CUSTOMER' }),
    name('Staples', {
      descriptions: [
        {
          key: 'pos staples',
          description: 'POS STAPLES #12',
          category: 'Office Expense',
          rows: 2,
          rule: null,
          exceptions: [],
        },
      ],
    }),
    name('Unclarified name', { unclarified: true, group: 'OTHER' }),
    name('Walmart'),
  ],
  subDescriptions: {
    7: [
      {
        key: 'wm rent',
        description: 'WM RENT PAYMENT',
        category: 'Rent',
        rows: 1,
        rule: null,
        exceptions: [],
      },
    ],
  },
};
const subs = subsByParent([sub(7, 'Walmart', 'Walmart - Rent')]);
const none = new Map<string, Set<string>>();

describe('names-query.util', () => {
  it('lists every name but Unclarified, filtered by group', () => {
    expect(
      filterNames(view, subs, { filter: 'ALL', q: '', hits: none }).map(
        (n) => n.name,
      ),
    ).toEqual(['Acme', 'Staples', 'Walmart']);
    expect(
      filterNames(view, subs, { filter: 'CUSTOMER', q: '', hits: none }).map(
        (n) => n.name,
      ),
    ).toEqual(['Acme']);
  });

  it('searches names, descriptions, sub-names, their descriptions and the bank search', () => {
    const find = (q: string, hits = none) =>
      filterNames(view, subs, { filter: 'ALL', q, hits }).map((n) => n.name);
    expect(find('acm')).toEqual(['Acme']);
    expect(find('pos staples')).toEqual(['Staples']);
    expect(find('- rent')).toEqual(['Walmart']);
    expect(find('rent payment')).toEqual(['Walmart']);
    expect(find('zzz', new Map([['acme', new Set(['k'])]]))).toEqual(['Acme']);
  });

  it('counts the chips (Unclarified only in ALL)', () => {
    expect(groupCounts(view, subs, { q: '', hits: none })).toEqual({
      ALL: 4,
      CUSTOMER: 1,
      SUPPLIER: 2,
    });
  });

  it('pages and picks a page’s sub-name entries', () => {
    expect(pageOfNames([1, 2, 3, 4, 5], 0, 2)).toEqual({
      items: [1, 2],
      nextOffset: 2,
    });
    expect(pageOfNames([1, 2, 3, 4, 5], 4, 2)).toEqual({
      items: [5],
      nextOffset: null,
    });
    expect(pickSubs({ 1: 'a', 2: 'b' }, [2, 3])).toEqual({ 2: 'b' });
  });
});
