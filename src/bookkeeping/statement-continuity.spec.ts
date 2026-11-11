import type { OpeningStatement } from './opening-balance.util';
import {
  chainHint,
  mismatchPairs,
  queueChainRereads,
} from './statement-continuity';

const st = (
  id: number,
  start: string,
  end: string,
  opening: number,
  closing: number,
  account = 'TD 1234',
): OpeningStatement => ({
  id,
  accountName: account,
  openingBalance: opening,
  closingBalance: closing,
  periodStart: new Date(`${start}T00:00:00Z`),
  periodEnd: new Date(`${end}T00:00:00Z`),
  net: closing - opening,
});

describe('mismatchPairs (step2, 2026-11-11)', () => {
  it('both sides of a balance that does not carry over', () => {
    const list = [
      st(1, '2026-01-01', '2026-01-31', 100, 200),
      st(2, '2026-02-01', '2026-02-28', 250, 300),
      st(3, '2026-03-01', '2026-03-31', 300, 400),
    ];
    expect(mismatchPairs(list).sort()).toEqual([1, 2]);
  });

  it('a gap is a missing statement, not a re-read', () => {
    const list = [
      st(1, '2026-01-01', '2026-01-31', 100, 200),
      st(2, '2026-03-01', '2026-03-31', 250, 300),
    ];
    expect(mismatchPairs(list)).toEqual([]);
  });

  it('only the accounts asked for', () => {
    const list = [
      st(1, '2026-01-01', '2026-01-31', 100, 200),
      st(2, '2026-02-01', '2026-02-28', 250, 300),
    ];
    expect(mismatchPairs(list, new Set(['BMO 9']))).toEqual([]);
  });
});

describe('chainHint', () => {
  it("names where the neighbours end and start, and what this one was read as", () => {
    const list = [
      st(1, '2026-01-01', '2026-01-31', 100, 200),
      st(2, '2026-02-01', '2026-02-28', 250, 300),
      st(3, '2026-03-01', '2026-03-31', 310, 400),
    ];
    const hint = chainHint(list, 2)!;
    expect(hint).toContain(
      'The previous statement of this account (ending 2026-01-31) ends at $200.00. This statement\'s opening balance was read as $250.00.',
    );
    expect(hint).toContain(
      "The next statement of this account (starting 2026-03-01) opens at $310.00. This statement's closing balance was read as $300.00.",
    );
    expect(hint).toContain('never change a figure');
  });

  it('none for a statement alone in its account', () => {
    expect(chainHint([st(1, '2026-01-01', '2026-01-31', 1, 2)], 1)).toBeNull();
  });
});

describe('queueChainRereads', () => {
  const scope = { customerId: 7, bookId: 3, companyId: null };
  const row = (s: OpeningStatement) => ({
    ...s,
    accountKind: null,
    bankName: null,
    filename: 'x.pdf',
    currency: null,
  });

  it('queues only DONE, uploaded, never-rechecked statements of the break', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      bankStatement: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            row(st(1, '2026-01-01', '2026-01-31', 100, 200)),
            row(st(2, '2026-02-01', '2026-02-28', 250, 300)),
          ])
          .mockResolvedValueOnce([]),
        updateMany,
      },
      bankTransaction: {
        groupBy: jest.fn().mockResolvedValue([
          { statementId: 1, _sum: { amount: 100 } },
          { statementId: 2, _sum: { amount: 50 } },
        ]),
      },
      customerAccountCurrency: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await expect(
      queueChainRereads(prisma as never, scope, ['TD 1234']),
    ).resolves.toBe(2);
    const where = updateMany.mock.calls[0][0].where;
    expect(where.id.in.sort()).toEqual([1, 2]);
    expect(where).toMatchObject({
      status: 'DONE',
      chainRereadAt: null,
      source: { not: 'PLAID' },
      deletedAt: null,
      bookId: 3,
    });
    expect(updateMany.mock.calls[0][0].data.status).toBe('PENDING');
  });

  it('never throws', async () => {
    const prisma = {
      bankStatement: { findMany: jest.fn().mockRejectedValue(new Error('db')) },
      bankTransaction: { groupBy: jest.fn().mockResolvedValue([]) },
      customerAccountCurrency: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await expect(queueChainRereads(prisma as never, scope, null)).resolves.toBe(0);
  });
});
