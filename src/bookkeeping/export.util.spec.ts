import { exportRowWithTaxes, netOf } from './export.service';

const row = {
  id: 42,
  pendingDate: null,
  postingDate: new Date('2026-09-02'),
  name: 'Stripe',
  description: 'STRIPE TRANSFER',
  amount: 100,
  debitAccount: 'Chase 4362',
  creditAccount: 'Sales Income',
  statement: 'Chase 4362 · Sep 2026',
};

describe('exportRowWithTaxes', () => {
  it('gives every tax line the id of its transaction', () => {
    const out = exportRowWithTaxes(row, 'Sales Income', [
      { agency: 'GST', rate: 5 },
      { agency: 'QST', rate: 9.975 },
    ]);
    expect(out.map((r) => r.id)).toEqual([42, 42, 42]);
    expect(out.map((r) => !!r.tax)).toEqual([false, true, true]);
  });

  it('takes the tax out of the row, so the lines add back to the bank amount', () => {
    const out = exportRowWithTaxes(row, 'Sales Income', [
      { agency: 'GST', rate: 10 },
    ]);
    expect(out.map((r) => r.amount)).toEqual([90.91, 9.09]);
    expect(out[1].creditAccount).toBe('GST');
    expect(netOf(out)).toBe(100);
  });

  it('leaves an untaxed row as it is', () => {
    expect(exportRowWithTaxes(row, 'Sales Income', [])).toEqual([row]);
  });
});
