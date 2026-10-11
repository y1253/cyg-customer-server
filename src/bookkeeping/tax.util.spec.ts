import {
  candidates,
  kindOf,
  includedTaxes,
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

describe('includedTaxes (tax INCLUDED in the bank amount)', () => {
  it('takes the tax out of the amount: $100 at 10% is $9.09 of tax', () => {
    expect(includedTaxes(100, [10])).toEqual([9.09]);
    expect(taxAmount(100, 10)).toBe(9.09);
    expect(taxAmount(-113, 13)).toBe(13);
  });

  it('splits several rates by their share of the combined tax, to the cent', () => {
    // GST 5% + QST 9.975% on $114.98 = $100 + $5 + $9.98
    const [gst, qst] = includedTaxes(114.98, [5, 9.975]);
    expect(gst).toBe(5);
    expect(qst).toBe(9.98);
  });

  it('a zero or missing rate taxes nothing', () => {
    expect(includedTaxes(100, [])).toEqual([]);
    expect(includedTaxes(100, [0])).toEqual([0]);
  });
});

describe('taxLines', () => {
  const rows = candidates(
    [row(1, 100, 'Sales Income'), row(2, -50, 'Office Expense')],
    [federal, state, input],
  );

  // $100 with 10% + 5% INCLUDED: $13.04 of tax, split 8.70 / 4.34 (the last absorbs the cent).
  it('allows several agencies on one row', () => {
    const lines = taxLines(
      rows,
      [{ id: 1, agencyIds: [1, 2] }],
      [federal, state],
    );
    expect(lines).toEqual([
      { transactionId: 1, agencyId: 1, kind: 'SALES', rate: 10, amount: 8.7 },
      { transactionId: 1, agencyId: 2, kind: 'SALES', rate: 5, amount: 4.34 },
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
      { transactionId: 1, agencyId: 4, kind: 'SALES', rate: 2, amount: 1.96 },
      {
        transactionId: 2,
        agencyId: 4,
        kind: 'PURCHASE',
        rate: 3,
        amount: 1.46,
      },
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
  const total = (r: {
    parent: { amount: number };
    taxes: { amount: number }[];
  }) =>
    [r.parent, ...r.taxes].reduce((c, x) => c + Math.round(x.amount * 100), 0);

  it('takes the tax OUT of a sale and credits the agency', () => {
    const r = taxSplit(sale, [{ agency: 'Federal Tax', rate: 10 }]);
    expect(r.parent).toEqual({ ...sale, amount: 90.91 });
    expect(r.taxes).toEqual([
      {
        amount: 9.09,
        offsetAccount: 'Federal Tax',
        debitAccount: 'Chase 4362',
        creditAccount: 'Federal Tax',
      },
    ]);
  });

  it('takes the tax OUT of a purchase and debits the agency', () => {
    const r = taxSplit(purchase, [{ agency: 'Input Credit', rate: 5 }]);
    expect(r.parent.amount).toBe(-47.62);
    expect(r.taxes).toEqual([
      {
        amount: -2.38,
        offsetAccount: 'Input Credit',
        debitAccount: 'Input Credit',
        creditAccount: 'Chase 4362',
      },
    ]);
  });

  it('the row and its taxes add back to the bank amount, to the cent', () => {
    const r = taxSplit({ ...sale, amount: 123.45 }, [
      { agency: 'Federal Tax', rate: 5 },
      { agency: 'State Tax', rate: 9.975 },
    ]);
    expect(total(r)).toBe(12345);
    const neg = taxSplit({ ...purchase, amount: -0.07 }, [
      { agency: 'Input Credit', rate: 13 },
    ]);
    expect(total(neg)).toBe(-7);
  });

  it('leaves an untaxed row alone', () => {
    expect(taxSplit(sale, [])).toEqual({ parent: sale, taxes: [] });
  });
});
