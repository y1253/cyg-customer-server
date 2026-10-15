import {
  kindOf,
  includedTaxes,
  nameTaxKey,
  nameTaxLines,
  taxAmount,
  taxSplit,
  type Agency,
  type NameTaxRow,
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
  name: string | null = 'Walmart',
): NameTaxRow => ({ id, amount, offsetAccount, name });

describe('kindOf', () => {
  it('maps income to sales, expenses to purchases, and never taxes the balance sheet', () => {
    expect(kindOf('Sales Income')).toBe('SALES');
    expect(kindOf('Office Expense')).toBe('PURCHASE');
    expect(kindOf('Uncategorized')).toBe('PURCHASE');
    expect(kindOf('Transfer Between Accounts')).toBeNull();
    expect(kindOf("Owner's Loan")).toBeNull();
    expect(kindOf('Owner Draw')).toBeNull();
    // An account no longer in the chart is an expense in the reports, so a purchase here.
    expect(kindOf('Some Renamed Account')).toBe('PURCHASE');
  });

  it("follows the customer's own types and moves", () => {
    const ctx = {
      custom: new Map([['Consulting', 'INCOME' as const]]),
      overrides: new Map([['Office Expense', 'ASSET' as const]]),
      liabilities: new Set(['GST']),
    };
    expect(kindOf('Consulting', ctx)).toBe('SALES');
    expect(kindOf('Office Expense', ctx)).toBeNull();
    expect(kindOf('GST', ctx)).toBeNull();
  });
});

describe('nameTaxLines (tax decided by the payee name, no AI)', () => {
  const agencies = [federal, state, input, gst];

  it('taxes nothing for a name with no agencies — the default', () => {
    expect(
      nameTaxLines([row(1, 100, 'Sales Income')], new Map(), agencies).size,
    ).toBe(0);
  });

  it("takes each picked agency's rate for the row's kind", () => {
    const picked = new Map([[nameTaxKey('Walmart'), [4, 1]]]);
    const lines = nameTaxLines(
      [row(1, 100, 'Sales Income'), row(2, -50, 'Office Expense')],
      picked,
      agencies,
    );
    // Agencies keep their own order; Federal Tax has no purchase rate.
    expect(lines.get(1)).toEqual([
      { agencyId: 1, agency: 'Federal Tax', kind: 'SALES', rate: 10 },
      { agencyId: 4, agency: 'GST', kind: 'SALES', rate: 2 },
    ]);
    expect(lines.get(2)).toEqual([
      { agencyId: 4, agency: 'GST', kind: 'PURCHASE', rate: 3 },
    ]);
  });

  it('matches names case-insensitively and the nameless rows as Unclarified name', () => {
    const picked = new Map([
      [nameTaxKey('walmart'), [3]],
      [nameTaxKey(null), [2]],
    ]);
    const lines = nameTaxLines(
      [row(1, -10, 'Supplies', 'WALMART'), row(2, -20, 'Supplies', null)],
      picked,
      agencies,
    );
    expect(lines.get(1)?.map((l) => l.agencyId)).toEqual([3]);
    expect(lines.get(2)?.map((l) => l.agencyId)).toEqual([2]);
  });

  it('never taxes a balance-sheet row or a fully split one', () => {
    const picked = new Map([[nameTaxKey('Walmart'), [2]]]);
    const lines = nameTaxLines(
      [row(1, -200, 'Credit Card Payment'), row(2, 0, 'Supplies')],
      picked,
      agencies,
    );
    expect(lines.size).toBe(0);
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
