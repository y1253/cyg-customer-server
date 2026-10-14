import {
  groupProducts,
  itemsToAsk,
  productMemoryWrites,
  resolveItem,
} from './product-memory.util';
import { itemKey } from './receipt-items.util';

describe('product memory', () => {
  const pampers = itemKey('Pampers Size 4');

  describe('resolveItem', () => {
    it("the customer's rule wins over the memory", () => {
      expect(
        resolveItem(
          pampers,
          new Map([[pampers, 'Supplies']]),
          new Map([[pampers, 'Meals & Entertainment']]),
          'Uncategorized',
        ),
      ).toEqual({ category: 'Supplies', source: 'rule' });
    });

    it('the memory wins over the parent', () => {
      expect(
        resolveItem(
          pampers,
          new Map(),
          new Map([[pampers, 'Supplies']]),
          'Meals & Entertainment',
        ),
      ).toEqual({ category: 'Supplies', source: 'memory' });
    });

    it('an Uncategorized memory or an unknown item falls back to the parent', () => {
      expect(
        resolveItem(
          pampers,
          new Map(),
          new Map([[pampers, 'Uncategorized']]),
          'Meals & Entertainment',
        ),
      ).toEqual({ category: 'Meals & Entertainment', source: 'parent' });
      expect(resolveItem('', new Map(), new Map(), 'X')).toEqual({
        category: 'X',
        source: 'parent',
      });
    });
  });

  describe('itemsToAsk', () => {
    it('asks only about items nobody knows, once per key', () => {
      const soap = itemKey('Soap');
      const out = itemsToAsk(
        ['Pampers Size 4', 'PAMPERS size 5', 'Soap', 'Tissue', '1234'],
        new Map([[soap, 'Supplies']]),
        new Map(),
      );
      expect(out).toEqual([
        { key: pampers, name: 'Pampers Size 4' },
        { key: itemKey('Tissue'), name: 'Tissue' },
      ]);
    });

    it('re-asks an item the memory holds as Uncategorized', () => {
      expect(
        itemsToAsk(
          ['Pampers Size 4'],
          new Map(),
          new Map([[pampers, 'Uncategorized']]),
        ),
      ).toEqual([{ key: pampers, name: 'Pampers Size 4' }]);
    });
  });

  describe('productMemoryWrites', () => {
    it('creates new keys once, fills gaps, never replaces or stores Uncategorized', () => {
      const out = productMemoryWrites(
        [
          { key: 'new', name: 'New', category: 'supplies' },
          { key: 'new', name: 'New again', category: 'Meals & Entertainment' },
          { key: 'gap', name: 'Gap', category: 'Supplies' },
          { key: 'known', name: 'Known', category: 'Supplies' },
          { key: 'blank', name: 'Blank', category: 'Uncategorized' },
          { key: 'bogus', name: 'Bogus', category: 'Not an account' },
        ],
        new Map([
          ['gap', 'Uncategorized'],
          ['known', 'Meals & Entertainment'],
        ]),
      );
      expect(out.creates).toEqual([
        { itemKey: 'new', sampleName: 'New', category: 'Supplies' },
      ]);
      expect(out.fills).toEqual([
        { itemKey: 'gap', sampleName: 'Gap', category: 'Supplies' },
      ]);
    });
  });
});

describe('groupProducts', () => {
  it('groups rows by item key, newest spelling, rule over usual category', () => {
    const out = groupProducts(
      [
        {
          id: 1,
          itemName: 'PAMPERS 4',
          amount: -40,
          offsetAccount: 'Supplies',
        },
        {
          id: 3,
          itemName: 'Pampers',
          amount: -20.5,
          offsetAccount: 'Supplies',
        },
        {
          id: 2,
          itemName: 'Soap',
          amount: -5,
          offsetAccount: 'Office Expense',
        },
      ],
      new Map([[itemKey('soap'), 'Supplies']]),
      new Map([[itemKey('pampers'), 'Supplies']]),
    );
    expect(out).toEqual([
      {
        itemKey: 'pampers',
        name: 'Pampers',
        category: 'Supplies',
        source: 'memory',
        suggested: 'Supplies',
        rows: 2,
        total: 60.5,
      },
      {
        itemKey: 'soap',
        name: 'Soap',
        category: 'Supplies',
        source: 'rule',
        suggested: null,
        rows: 1,
        total: 5,
      },
    ]);
  });
});
