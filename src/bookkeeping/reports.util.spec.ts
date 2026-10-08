import { OWNERS_LOAN } from './chart-of-accounts';
import {
  buildReports,
  RETAINED_EARNINGS,
  type ReportRow,
} from './reports.util';

const BANK = 'Chase 4362';
const row = (
  amount: number,
  offsetAccount: string,
  date: string | null = '2026-09-10',
): ReportRow => ({ amount, offsetAccount, bankAccount: BANK, date });

const line = (ls: Array<{ name: string; amount: number }>, name: string) =>
  ls.find((l) => l.name === name)?.amount;

describe('buildReports', () => {
  const rows = [
    row(500, OWNERS_LOAN, '2026-08-01'), // the "Starting balance" row
    row(1000, 'Sales Income', '2026-08-05'),
    row(-120.1, 'Office Expense', '2026-09-01'),
    row(20.05, 'Office Expense', '2026-09-03'), // a refund
    row(-15, 'Bank Fees', '2026-09-30'),
    row(-300, 'Owner Draw', '2026-09-15'),
    row(-200, 'Credit Card Payment', '2026-09-20'),
    row(-50, 'Transfer Between Accounts', '2026-09-21'),
    row(-9.99, 'Uncategorized', '2026-09-22'),
  ];
  it('shows each account on its normal side, a refund lowering the expense', () => {
    const r = buildReports(rows);
    const acc = (n: string) => r.accounts.find((a) => a.name === n)!;
    expect(acc('Office Expense')).toMatchObject({ balance: 100.05, count: 2 });
    expect(acc('Sales Income')).toMatchObject({ balance: 1000, count: 1 });
    expect(acc('Owner Draw').balance).toBe(-300);
    expect(acc('Rent')).toMatchObject({ balance: 0, count: 0 });
    expect(acc(BANK)).toMatchObject({ bank: true, type: 'ASSET', count: 9 });
  });

  it('builds the income statement', () => {
    const { incomeStatement: is } = buildReports(rows);
    expect(is.totalIncome).toBe(1000);
    expect(line(is.expenses, 'Office Expense')).toBe(100.05);
    expect(is.totalExpenses).toBe(125.04);
    expect(is.netIncome).toBe(874.96);
    expect(line(is.expenses, 'Rent')).toBeUndefined();
  });

  it('builds a balance sheet that balances', () => {
    const { balanceSheet: bs } = buildReports(rows);
    // 500 starting balance + 1000 - 120.10 + 20.05 - 15 - 300 - 200 - 50 - 9.99
    expect(line(bs.assets, BANK)).toBe(824.96);
    expect(line(bs.assets, 'Transfer Between Accounts')).toBe(50);
    expect(line(bs.liabilities, 'Credit Card Payment')).toBe(-200);
    expect(line(bs.liabilities, OWNERS_LOAN)).toBe(500);
    expect(bs.equity.map((l) => l.name)).not.toContain(
      'Opening Balance Equity',
    );
    expect(line(bs.equity, RETAINED_EARNINGS)).toBe(874.96);
    expect(bs.totalAssets).toBe(874.96);
    expect(bs.totalLiabilitiesAndEquity).toBe(874.96);
    expect(bs.balanced).toBe(true);
  });

  it('limits the period, but the balance sheet keeps everything up to the end date', () => {
    const r = buildReports(rows, '2026-09-01', '2026-09-20');
    expect(r.incomeStatement.totalIncome).toBe(0);
    expect(r.incomeStatement.totalExpenses).toBe(100.05);
    expect(r.balanceSheet.asOf).toBe('2026-09-20');
    // The August sale is before `from` but still in retained earnings.
    expect(line(r.balanceSheet.equity, RETAINED_EARNINGS)).toBe(899.95);
    expect(line(r.balanceSheet.assets, 'Transfer Between Accounts')).toBe(
      undefined,
    );
    expect(r.balanceSheet.balanced).toBe(true);
  });

  it('counts undated rows only when no period is set', () => {
    const undated = [row(-40, 'Rent', null)];
    expect(buildReports(undated).incomeStatement.totalExpenses).toBe(40);
    expect(
      buildReports(undated, null, '2026-12-31').incomeStatement.totalExpenses,
    ).toBe(0);
  });

  it('reports uncategorized rows and keeps renamed accounts as expenses', () => {
    const r = buildReports([...rows, row(-7, 'Old Name')]);
    expect(r.uncategorized).toEqual({ count: 1, amount: 9.99 });
    expect(line(r.incomeStatement.expenses, 'Old Name')).toBe(7);
    expect(r.balanceSheet.balanced).toBe(true);
  });
});
