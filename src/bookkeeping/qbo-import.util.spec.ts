import {
  accountTypeOf,
  analyze,
  cleanTxns,
  matchTxns,
  SKIP,
  SPLIT,
  type BookRow,
  type QboHistoryTxn,
} from './qbo-import.util';

const txn = (over: Partial<QboHistoryTxn> = {}): QboHistoryTxn => ({
  qboId: 'q1',
  type: 'Purchase',
  date: '2026-03-10',
  cents: -5000,
  bankAccountId: '35',
  bankAccountName: 'TD Chequing',
  payee: 'Walmart',
  lines: [
    { category: 'Office Supplies', categoryType: 'Expense', cents: 5000 },
  ],
  ...over,
});

const row = (over: Partial<BookRow> = {}): BookRow => ({
  id: 1,
  date: '2026-03-11',
  cents: -5000,
  description: 'POS WALMART #1234 TORONTO',
  name: 'Walmart',
  category: 'Uncategorized',
  qboAccountId: '35',
  accountName: 'TD 4562',
  ...over,
});

describe('matchTxns', () => {
  it('matches the same amount within 3 days on the same QuickBooks account', () => {
    const m = matchTxns([txn()], [row()]);
    expect(m.get('q1')?.id).toBe(1);
  });

  it('never matches past 3 days or another amount', () => {
    expect(matchTxns([txn()], [row({ date: '2026-03-14' })]).size).toBe(0);
    expect(matchTxns([txn()], [row({ cents: -5001 })]).size).toBe(0);
  });

  it('takes the closest date when the account is known', () => {
    const m = matchTxns(
      [txn()],
      [row({ id: 1, date: '2026-03-12' }), row({ id: 2, date: '2026-03-10' })],
    );
    expect(m.get('q1')?.id).toBe(2);
  });

  it('with no account link, matches only a lone candidate', () => {
    const loose = { qboAccountId: null, accountName: 'Other' };
    expect(matchTxns([txn()], [row({ ...loose })]).size).toBe(1);
    expect(
      matchTxns([txn()], [row({ id: 1, ...loose }), row({ id: 2, ...loose })])
        .size,
    ).toBe(0);
  });

  it('uses each row once', () => {
    const m = matchTxns([txn({ qboId: 'a' }), txn({ qboId: 'b' })], [row()]);
    expect(m.size).toBe(1);
  });
});

describe('analyze', () => {
  it('proposes a NAME rule with the one category QuickBooks used', () => {
    const a = analyze({ since: null, txns: [txn()], rows: [row()], rules: [] });
    expect(a.names).toEqual([
      expect.objectContaining({
        payee: 'Walmart',
        category: 'Office Supplies',
        aliases: [],
        skip: false,
      }),
    ]);
    expect(a.questions).toEqual([]);
    expect(a.descriptions).toEqual([]);
  });

  it('asks about a payee filed under several categories, offering a split', () => {
    const a = analyze({
      since: null,
      txns: [
        txn({ qboId: 'a' }),
        txn({
          qboId: 'b',
          date: '2026-04-01',
          lines: [{ category: 'Meals', categoryType: 'Expense', cents: 5000 }],
        }),
      ],
      rows: [],
      rules: [],
    });
    expect(a.names[0].category).toBeNull();
    const q = a.questions.find((x) => x.kind === 'NAME_CATEGORIES')!;
    expect(q.options.map((o) => o.value)).toEqual([
      'Meals',
      'Office Supplies',
      SPLIT,
      SKIP,
    ]);
  });

  it('renames our name to the payee QuickBooks used (an alias)', () => {
    const a = analyze({
      since: null,
      txns: [txn({ payee: 'Wal-Mart Stores' })],
      rows: [row()],
      rules: [],
    });
    expect(a.names[0]).toMatchObject({
      payee: 'Wal-Mart Stores',
      aliases: ['Walmart'],
    });
    // The rename already reaches the payee, so no description rule is needed.
    expect(a.descriptions).toEqual([]);
  });

  it('proposes a DESCRIPTION rule for rows with no name', () => {
    const a = analyze({
      since: null,
      txns: [txn()],
      rows: [row({ name: null })],
      rules: [],
    });
    expect(a.descriptions).toEqual([
      expect.objectContaining({
        payee: 'Walmart',
        category: 'Office Supplies',
        example: 'POS WALMART #1234 TORONTO',
      }),
    ]);
  });

  it('asks when one description went to two payees', () => {
    const a = analyze({
      since: null,
      txns: [
        txn({ qboId: 'a', payee: 'Costco' }),
        txn({ qboId: 'b', payee: 'Walmart', date: '2026-04-10' }),
      ],
      rows: [
        row({ id: 1, name: null }),
        row({ id: 2, name: null, date: '2026-04-10' }),
      ],
      rules: [],
    });
    const q = a.questions.find((x) => x.kind === 'DESCRIPTION_CONFLICT')!;
    expect(q.options.map((o) => o.label)).toEqual(
      expect.arrayContaining(['Costco', 'Walmart']),
    );
    expect(a.descriptions).toEqual([]);
  });

  it('asks before overwriting the customer’s own rule', () => {
    const a = analyze({
      since: null,
      txns: [txn()],
      rows: [],
      rules: [
        {
          matchType: 'NAME',
          matchKey: 'walmart',
          name: null,
          category: 'Groceries',
        },
      ],
    });
    expect(a.questions).toEqual([
      expect.objectContaining({
        kind: 'RULE_CONFLICT',
        target: { type: 'name-category', id: a.names[0].id },
      }),
    ]);
  });

  it('lists every category with its QuickBooks type', () => {
    const a = analyze({ since: null, txns: [txn()], rows: [], rules: [] });
    expect(a.categories).toEqual([
      { name: 'Office Supplies', type: 'Expense' },
    ]);
  });
});

describe('cleanTxns', () => {
  it('drops malformed transactions and lines', () => {
    expect(
      cleanTxns([
        { qboId: 'x', date: 'bad', cents: -1, lines: [] },
        {
          qboId: 'y',
          date: '2026-01-02',
          cents: -100,
          lines: [{ category: '' }],
        },
        'nope',
      ]),
    ).toEqual([
      expect.objectContaining({ qboId: 'y', lines: [], type: 'Purchase' }),
    ]);
  });
});

describe('accountTypeOf', () => {
  it('maps QuickBooks account types', () => {
    expect(accountTypeOf('Other Income')).toBe('INCOME');
    expect(accountTypeOf('Credit Card')).toBe('LIABILITY');
    expect(accountTypeOf('Other Current Asset')).toBe('ASSET');
    expect(accountTypeOf('Cost of Goods Sold')).toBe('EXPENSE');
    expect(accountTypeOf(null)).toBe('EXPENSE');
  });
});
