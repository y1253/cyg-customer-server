import { listStatements, type StatementRow } from './statement-list.util';

const row = (
  id: number,
  accountName: string | null,
  periodEnd: string | null,
  status = 'DONE',
): StatementRow => ({
  id,
  label: `${accountName} · ${periodEnd}`,
  status,
  accountName,
  periodStart: null,
  periodEnd: periodEnd && `${periodEnd}T00:00:00.000Z`,
  transactionCount: 10,
  error: null,
  createdAt: new Date('2026-10-27'),
});

describe('listStatements', () => {
  // Customer 43, 2026-10-27: 80 BMO / Wise statements + the Amex ones. The whole list
  // was longer than the tool cap and the Amex rows were cut.
  const book: StatementRow[] = [
    ...Array.from({ length: 80 }, (_, i) =>
      row(
        i + 1,
        i % 2 ? 'BMO 6454' : 'Wise Payments Canada Inc. 0001',
        `2025-0${(i % 9) + 1}-15`,
      ),
    ),
    row(266, 'American Express 1004', '2026-07-26'),
    row(267, 'American Express 1004', '2026-08-26', 'NEEDS_REVIEW'),
    row(268, 'American Express 1004', '2026-09-25'),
  ];

  it('always names every account, even when the rows are cut', () => {
    const out = listStatements(book, { limit: 5 });
    expect(out.total).toBe(83);
    expect(out.statements).toHaveLength(5);
    expect(out.note).toMatch(/Showing 5 of 83/);
    expect(out.accounts.map((a) => a.account)).toEqual([
      'American Express 1004',
      'BMO 6454',
      'Wise Payments Canada Inc. 0001',
    ]);
    expect(out.accounts[0]).toMatchObject({
      statements: 3,
      latestPeriodEnd: '2026-09-25',
      notDone: 1,
    });
  });

  it('finds an account by the words of its name, and "amex"', () => {
    for (const account of ['american express 1004', 'AMEX', 'express 1004']) {
      const out = listStatements(book, { account });
      expect(out.statements.map((s) => s.id)).toEqual([268, 267, 266]);
    }
    expect(listStatements(book, { account: 'amex 9999' }).statements).toEqual(
      [],
    );
  });

  it('filters by status and by an overlapping period', () => {
    expect(
      listStatements(book, { status: 'needs_review' }).statements.map(
        (s) => s.id,
      ),
    ).toEqual([267]);
    expect(
      listStatements(book, {
        account: 'american express',
        from: '2026-08-01',
        to: '2026-08-31',
      }).statements.map((s) => s.id),
    ).toEqual([267]);
  });

  it('never hides a statement whose period was not read', () => {
    const out = listStatements([row(1, null, null, 'UPLOADED')], {
      from: '2020-01-01',
      to: '2020-01-31',
    });
    expect(out.statements).toHaveLength(1);
    expect(out.accounts[0].account).toBe('Not sorted yet');
  });
});
