import { reconcile } from './reconcile.util';
import {
  assemble,
  better,
  closingOf,
  type PageReading,
} from './statement-extractor';
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

/**
 * TD-shaped (synthetic numbers): every page prints its OWN Credits/Debits box and a
 * "balance forward"; the balance is printed on each day's last row; the last page is
 * cheque images. Page 1's box was once compared with the whole statement — a false
 * "doesn't match" on a perfectly read statement.
 */
describe('assemble: per-page summary boxes (TD)', () => {
  const box = (
    opening: number,
    closing: number,
    dep: number,
    depCount: number,
    wd: number,
    wdCount: number,
  ) => ({
    ...page({}).stated,
    openingBalance: opening,
    closingBalance: closing,
    totalDeposits: dep,
    depositCount: depCount,
    totalWithdrawals: wd,
    withdrawalCount: wdCount,
    totalsScope: 'all' as const,
  });
  const td = () => [
    page({
      stated: box(1000, 1150, 300, 2, 150, 2),
      transactions: [
        tx(100, null),
        tx(-50, null),
        tx(200, 1250),
        tx(-100, 1150),
      ],
    }),
    page({
      stated: box(1150, 1175, 50, 1, 25, 1),
      transactions: [tx(-25, null), tx(50, 1175)],
    }),
    page({}), // cheque images: nothing to list
  ];

  it('checks each page against its own box → VERIFIED', () => {
    const out = assemble(td());
    expect(out.stated.closingBalance).toBe(1175); // the LAST page's, not page 1's
    expect(out.verification.verification).toBe('VERIFIED');
    const deposits = out.verification.checks.filter(
      (c) => c.name === 'deposits',
    );
    expect(deposits.map((c) => c.page)).toEqual([0, 1]);
  });

  it('signs read from the wrong column are fixed from the running balance', () => {
    const pages = td();
    pages[0].transactions[1] = tx(50, null); // really −50
    const out = assemble(pages);
    expect(out.signFixes).toBe(1);
    expect(out.transactions[1].amount).toBe(-50);
    expect(out.verification.verification).toBe('VERIFIED');
  });

  it('a dropped row fails only its own page, which is named as the suspect', () => {
    const pages = td();
    pages[1].transactions.shift(); // the −25 on page 2
    const out = assemble(pages);
    expect(out.verification.verification).toBe('MISMATCH');
    expect(out.verification.suspectPages).toEqual([1]);
    const failed = out.verification.checks.filter((c) => !c.ok && !c.skipped);
    expect(failed.every((c) => c.page === 1 || c.page === undefined)).toBe(
      true,
    );
  });

  it('cheque images read as new withdrawals: the ending balance fails and names that page', () => {
    const pages = td();
    pages[2] = page({ transactions: [tx(-100, null)] });
    const out = assemble(pages);
    expect(out.verification.verification).toBe('MISMATCH');
    expect(out.verification.suspectPages).toEqual([2]);
  });

  it('the SAME box repeated on every page is the statement total, checked once', () => {
    const stated = box(1000, 1175, 350, 3, 175, 3);
    const pages = td();
    pages[0].stated = stated;
    pages[1].stated = { ...stated };
    const out = assemble(pages);
    expect(out.verification.verification).toBe('VERIFIED');
    expect(out.verification.checks.every((c) => c.page === undefined)).toBe(
      true,
    );
  });
});

describe('closingOf', () => {
  const withClosing = (
    closingBalance: number | null,
    balances: Array<number | null>,
  ) =>
    page({
      stated: { ...page({}).stated, closingBalance },
      transactions: balances.map((b) => tx(-1, b)),
    });

  it('prefers the closing balance the running balance actually ends on', () => {
    // Page 2's "22.00" is a stray figure; the rows end on 24,170.17.
    expect(
      closingOf([
        withClosing(24170.17, [null, 25000]),
        withClosing(22, [24170.17]),
      ]),
    ).toBe(24170.17);
  });

  it('otherwise the last page that prints one', () => {
    expect(closingOf([withClosing(100, []), withClosing(90, [])])).toBe(90);
    expect(closingOf([withClosing(null, [])])).toBeNull();
  });
});
