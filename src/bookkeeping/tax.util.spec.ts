import {
  candidates,
  kindOf,
  taxAmount,
  taxEntry,
  taxLines,
  taxReportRows,
  withTaxRows,
  type Agency,
  type TaxableRow,
} from './tax.util';

const federal: Agency = { id: 1, name: 'Federal Tax', type: 'SALES', rate: 10 };
const state: Agency = { id: 2, name: 'State Tax', type: 'BOTH', rate: 5 };
const input: Agency = {
  id: 3,
  name: 'Input Credit',
  type: 'PURCHASE',
  rate: 7,
};

const row = (
  id: number,
  amount: number,
  offsetAccount: string,
): TaxableRow => ({
  id,
  amount,
  offsetAccount,
  description: `row ${id}`,
  name: null,
});

describe('kindOf', () => {
  it('maps income to sales, expenses to purchases, and never taxes the balance sheet', () => {
    expect(kindOf('Sales Income')).toBe('SALES');
    expect(kindOf('Office Expense')).toBe('PURCHASE');
    expect(kindOf('Uncategorized')).toBe('PURCHASE');
    expect(kindOf('Transfer Between Accounts')).toBeNull();
    expect(kindOf("Owner's Loan")).toBeNull();
    expect(kindOf('Owner Draw')).toBeNull();
    expect(kindOf('Some Renamed Account')).toBeNull();
  });
});

describe('candidates', () => {
  const rows = [
    row(1, 100, 'Sales Income'),
    row(2, -50, 'Office Expense'),
    row(3, -200, 'Credit Card Payment'),
  ];

  it('keeps only rows a matching agency could tax', () => {
    expect(candidates(rows, [federal]).map((r) => [r.id, r.kind])).toEqual([
      [1, 'SALES'],
    ]);
    expect(candidates(rows, [input]).map((r) => r.id)).toEqual([2]);
    expect(candidates(rows, [state]).map((r) => r.id)).toEqual([1, 2]);
    expect(candidates(rows, [])).toEqual([]);
  });
});

describe('taxAmount', () => {
  it('is amount × rate on top, in whole cents', () => {
    expect(taxAmount(100, 10)).toBe(10);
    expect(taxAmount(-19.99, 13)).toBe(2.6);
    expect(taxAmount(33.33, 9.975)).toBe(3.32);
  });
});

describe('taxLines', () => {
  const rows = candidates(
    [row(1, 100, 'Sales Income'), row(2, -50, 'Office Expense')],
    [federal, state, input],
  );

  it('allows several agencies on one row', () => {
    const lines = taxLines(
      rows,
      [{ id: 1, agencyIds: [1, 2] }],
      [federal, state],
    );
    expect(lines).toEqual([
      { transactionId: 1, agencyId: 1, kind: 'SALES', rate: 10, amount: 10 },
      { transactionId: 1, agencyId: 2, kind: 'SALES', rate: 5, amount: 5 },
    ]);
  });

  it('drops unknown ids, wrong-kind agencies and repeats', () => {
    const lines = taxLines(
      rows,
      [
        { id: 1, agencyIds: [3, 99, 1, 1] }, // purchase agency on a sale; unknown; repeat
        { id: 2, agencyIds: [1, 3] }, // sales agency on a purchase
        { id: 42, agencyIds: [1] }, // not a candidate
      ],
      [federal, state, input],
    );
    expect(lines.map((l) => [l.transactionId, l.agencyId])).toEqual([
      [1, 1],
      [2, 3],
    ]);
  });
});

describe('taxEntry / taxReportRows', () => {
  it('credits the agency on a sale and debits it on a purchase', () => {
    expect(taxEntry('SALES', 'Sales Income', 'Federal Tax')).toEqual({
      debitAccount: 'Sales Income',
      creditAccount: 'Federal Tax',
    });
    expect(taxEntry('PURCHASE', 'Office Expense', 'Input Credit')).toEqual({
      debitAccount: 'Input Credit',
      creditAccount: 'Office Expense',
    });
  });

  it('nets to zero in the reports, the agency growing on a sale', () => {
    const r = taxReportRows('SALES', 'Sales Income', 'Federal Tax', 10);
    expect(r).toEqual([
      { amount: 10, offsetAccount: 'Federal Tax' },
      { amount: -10, offsetAccount: 'Sales Income' },
    ]);
    expect(taxReportRows('PURCHASE', 'Rent', 'Input Credit', 7)[0].amount).toBe(
      -7,
    );
  });
});

describe('withTaxRows', () => {
  it('puts the children right after their parent, in either order', () => {
    const kids = new Map([[2, ['2a', '2b']]]);
    expect(withTaxRows([1, 2, 3], (p) => kids.get(p))).toEqual([
      1,
      2,
      '2a',
      '2b',
      3,
    ]);
    expect(withTaxRows([3, 2, 1], (p) => kids.get(p))).toEqual([
      3,
      2,
      '2a',
      '2b',
      1,
    ]);
  });
});
