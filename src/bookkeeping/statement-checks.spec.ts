import { reconcile } from './reconcile.util';
import { assemble, better, type PageReading } from './statement-extractor';
import { statementLabel } from './statement-label';

const d = (iso: string) => new Date(iso + 'T00:00:00Z');

describe('statementLabel', () => {
  const base = {
    accountName: 'Chase 4362',
    bankName: 'Chase',
    filename: 'sep.pdf',
  };

  it('one calendar month → "Chase 4362 · Sep 2026"', () => {
    expect(
      statementLabel({
        ...base,
        periodStart: d('2026-09-01'),
        periodEnd: d('2026-09-30'),
      }),
    ).toBe('Chase 4362 · Sep 2026');
  });

  it('a period across months → the range', () => {
    expect(
      statementLabel({
        ...base,
        periodStart: d('2026-09-15'),
        periodEnd: d('2026-10-14'),
      }),
    ).toBe('Chase 4362 · Sep 15 – Oct 14, 2026');
    expect(
      statementLabel({
        ...base,
        periodStart: d('2026-12-15'),
        periodEnd: d('2027-01-14'),
      }),
    ).toBe('Chase 4362 · Dec 15, 2026 – Jan 14, 2027');
  });

  it('falls back to the bank name, then the filename', () => {
    expect(
      statementLabel({
        ...base,
        accountName: null,
        periodStart: null,
        periodEnd: null,
      }),
    ).toBe('Chase');
    expect(
      statementLabel({
        accountName: null,
        bankName: null,
        filename: 'scan.pdf',
        periodStart: null,
        periodEnd: null,
      }),
    ).toBe('scan.pdf');
  });
});

function page(over: Partial<PageReading>): PageReading {
  return {
    isBankStatement: true,
    accountName: null,
    bankName: null,
    periodStart: null,
    periodEnd: null,
    stated: {
      openingBalance: null,
      closingBalance: null,
      totalDeposits: null,
      totalWithdrawals: null,
      depositCount: null,
      withdrawalCount: null,
    },
    transactions: [],
    ...over,
  };
}
const tx = (amount: number, balanceAfter: number | null) => ({
  pendingDate: null,
  postingDate: '2026-09-02',
  description: 'X',
  amount,
  balanceAfter,
  offsetAccount: 'Office Expense',
});

describe('assemble', () => {
  it("takes the bank's figures from whichever page prints them and tags each row with its page", () => {
    const p1 = page({
      accountName: 'Chase 4362',
      stated: { ...page({}).stated, openingBalance: 100, totalWithdrawals: 30 },
      transactions: [tx(-10, 90)],
    });
    const p2 = page({
      stated: { ...page({}).stated, closingBalance: 70 },
      transactions: [tx(-20, 70)],
    });
    const out = assemble([p1, p2]);
    expect(out.accountName).toBe('Chase 4362');
    expect(out.stated).toMatchObject({
      openingBalance: 100,
      closingBalance: 70,
      totalWithdrawals: 30,
    });
    expect(out.transactions.map((t) => t.page)).toEqual([0, 1]);
    expect(out.verification.verification).toBe('VERIFIED');
  });

  it('a page that dropped a row makes it MISMATCH and is named as the suspect', () => {
    const p1 = page({
      stated: { ...page({}).stated, openingBalance: 100, closingBalance: 50 },
      transactions: [tx(-10, 90)],
    });
    const p2 = page({ transactions: [tx(-20, 50)] }); // a -20 row is missing: 90 - 20 = 70, not 50
    const out = assemble([p1, p2]);
    expect(out.verification.verification).toBe('MISMATCH');
    expect(out.verification.suspectPages).toEqual([1]);
  });
});

describe('better', () => {
  const stated = {
    openingBalance: 100,
    closingBalance: 70,
    totalDeposits: null,
    totalWithdrawals: 30,
    depositCount: null,
    withdrawalCount: null,
  };
  it('prefers the reading that makes more checks pass, then the smaller money gap', () => {
    const right = reconcile(stated, [
      { amount: -10, balanceAfter: 90, page: 0 },
      { amount: -20, balanceAfter: 70, page: 1 },
    ]);
    const wrong = reconcile(stated, [
      { amount: -10, balanceAfter: 90, page: 0 },
    ]);
    const closer = reconcile(stated, [
      { amount: -10, balanceAfter: 90, page: 0 },
      { amount: -19, balanceAfter: null, page: 1 },
    ]);
    expect(better(right, wrong)).toBe(true);
    expect(better(wrong, right)).toBe(false);
    expect(better(closer, wrong)).toBe(true); // same checks failing, but $1 off instead of $20
  });
});

describe('assemble: totalsScope', () => {
  it('comes from the page the totals were copied from, not a later page without them', () => {
    const p1 = page({
      stated: { ...page({}).stated, totalWithdrawals: 30, totalsScope: 'all' },
      transactions: [tx(-10, null)],
    });
    const p2 = page({
      stated: { ...page({}).stated, totalsScope: 'partial' },
      transactions: [tx(-10, null)],
    });
    const out = assemble([p1, p2]);
    expect(out.stated.totalsScope).toBe('all');
    expect(out.verification.verification).toBe('MISMATCH'); // a dropped row is not excused
  });
});
