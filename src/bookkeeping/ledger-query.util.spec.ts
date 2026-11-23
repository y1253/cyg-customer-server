import type { TransactionView } from './bookkeeping.service';
import { pageOfFamilies, queryLedger } from './ledger-query.util';

const row = (over: Partial<TransactionView>): TransactionView => ({
  key: `t:${over.id}`,
  id: 0,
  statementId: 1,
  pendingDate: null,
  postingDate: '2026-01-10',
  description: 'POS WALMART 1234',
  name: 'Walmart',
  amount: -10,
  offsetAccount: 'Office Expense',
  debitAccount: 'Office Expense',
  creditAccount: 'TD 1234',
  statementLabel: 'TD 1234 · Jan 2026',
  ...over,
});

const ctx = { periodEnd: new Map<number, string | null>([[1, '2026-01-31']]) };

describe('queryLedger', () => {
  const book = [
    row({ id: 1, amount: -60 }),
    row({
      id: 10,
      key: 's:10',
      kind: 'split',
      splitOfId: 1,
      amount: -40,
      offsetAccount: 'GST',
    }),
    row({
      id: 2,
      name: 'Staples',
      description: 'STAPLES 99',
      amount: -5,
      postingDate: '2026-02-01',
    }),
    row({
      id: 3,
      name: null,
      description: 'BANK FEE',
      amount: -1,
      offsetAccount: 'Bank Fees',
    }),
  ];

  it('keeps a transaction and its splits together and adds the splits back as fullAmount', () => {
    const { families, summary } = queryLedger(book, {}, ctx);
    expect(families.map((f) => f.map((t) => t.id))).toEqual([
      [1, 10],
      [2],
      [3],
    ]);
    expect(families[0][0].fullAmount).toBe(-100);
    expect(summary).toMatchObject({
      txCount: 3,
      splitCount: 1,
      allTx: 3,
      net: -106,
      homeNet: null,
      families: 3,
    });
    expect(summary.byCategory[0]).toEqual({
      category: 'Office Expense',
      rows: 2,
      total: -65,
      homeTotal: -65,
    });
  });

  it('searches every row, and a name keeps the whole family', () => {
    expect(
      queryLedger(book, { q: 'staples' }, ctx)
        .families.flat()
        .map((t) => t.id),
    ).toEqual([2]);
    expect(
      queryLedger(book, { name: 'walmart' }, ctx)
        .families.flat()
        .map((t) => t.id),
    ).toEqual([1, 10]);
    expect(
      queryLedger(book, { name: 'Unclarified name' }, ctx)
        .families.flat()
        .map((t) => t.id),
    ).toEqual([3]);
  });

  it('filters by description key, range and column, and sorts by family head', () => {
    expect(
      queryLedger(book, { description: 'POS WALMART 999' }, ctx).summary
        .txCount,
    ).toBe(1);
    expect(
      queryLedger(book, { from: '2026-02-01' }, ctx)
        .families.flat()
        .map((t) => t.id),
    ).toEqual([2]);
    const sorted = queryLedger(
      book,
      { sort: { key: 'amount', dir: 'asc' } },
      ctx,
    ).families;
    expect(sorted.map((f) => f[0].id)).toEqual([1, 2, 3]);
    const folded = queryLedger(
      book,
      { folded: true, filters: { amount: { max: -50 } } },
      ctx,
    ).families;
    expect(folded.map((f) => f[0].id)).toEqual([1]);
    expect(
      queryLedger(
        book,
        { filters: { amount: { max: -50 } } },
        ctx,
      ).families.map((f) => f[0].id),
    ).toEqual([1]);
    expect(
      queryLedger(book, { filters: { amount: { max: -70 } } }, ctx).families,
    ).toEqual([]);
  });

  it('pages by family, never cutting one', () => {
    const { families } = queryLedger(book, {}, ctx);
    expect(pageOfFamilies(families, 0, 1)).toMatchObject({ nextOffset: 1 });
    expect(pageOfFamilies(families, 0, 1).rows.map((t) => t.id)).toEqual([
      1, 10,
    ]);
    expect(pageOfFamilies(families, 2, 5)).toMatchObject({ nextOffset: null });
  });
});
