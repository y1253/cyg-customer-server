import {
  candidates,
  kindOf,
  taxAmount,
  taxLines,
  taxSplit,
  type Agency,
  type TaxableRow,
} from './tax.util';

const federal: Agency = { id: 1, name: 'Federal Tax', rates: { SALES: 10 } };
const state: Agency = {
  id: 2,
  name: 'State Tax',
  rates: { SALES: 5, PURCHASE: 5 },
};
const input: Agency = { id: 3, name: 'Input Credit', rates: { PURCHASE: 7 } };
/** One agency, a different rate per kind. */
const gst: Agency = { id: 4, name: 'GST', rates: { SALES: 2, PURCHASE: 3 } };

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

  it("uses the agency's rate for the row's kind", () => {
    const lines = taxLines(
      rows,
      [
        { id: 1, agencyIds: [4] },
        { id: 2, agencyIds: [4] },
      ],
      [gst],
    );
    expect(lines).toEqual([
      { transactionId: 1, agencyId: 4, kind: 'SALES', rate: 2, amount: 2 },
      { transactionId: 2, agencyId: 4, kind: 'PURCHASE', rate: 3, amount: 1.5 },
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

describe('taxSplit', () => {
  const sale = {
    amount: 100,
    offsetAccount: 'Sales Income',
    debitAccount: 'Chase 4362',
    creditAccount: 'Sales Income',
  };
  const purchase = {
    amount: -50,
    offsetAccount: 'Office Expense',
    debitAccount: 'Office Expense',
    creditAccount: 'Chase 4362',
  };

  it('keeps a sale at its bank amount, the tax on top, the agency credited', () => {
    const r = taxSplit(sale, [{ agency: 'Federal Tax', amount: 10 }]);
    expect(r.parent).toEqual(sale);
    expect(r.taxes).toEqual([
      {
        amount: 10,
        offsetAccount: 'Federal Tax',
        debitAccount: 'Chase 4362',
        creditAccount: 'Federal Tax',
      },
    ]);
  });

  it('keeps a purchase at its bank amount, the tax on top, the agency debited', () => {
    const r = taxSplit(purchase, [{ agency: 'Input Credit', amount: 2.5 }]);
    expect(r.parent.amount).toBe(-50);
    expect(r.taxes).toEqual([
      {
        amount: -2.5,
        offsetAccount: 'Input Credit',
        debitAccount: 'Input Credit',
        creditAccount: 'Chase 4362',
      },
    ]);
  });

  it('totals the bank amount plus every tax, to the cent', () => {
    const r = taxSplit({ ...sale, amount: 123.45 }, [
      { agency: 'Federal Tax', amount: 12.35 },
      { agency: 'State Tax', amount: 6.17 },
    ]);
    expect(r.parent.amount).toBe(123.45);
    const total = [r.parent, ...r.taxes].reduce(
      (c, x) => c + Math.round(x.amount * 100),
      0,
    );
    expect(total).toBe(12345 + 1235 + 617);
  });

  it('leaves an untaxed row alone', () => {
    expect(taxSplit(sale, [])).toEqual({ parent: sale, taxes: [] });
  });
});
