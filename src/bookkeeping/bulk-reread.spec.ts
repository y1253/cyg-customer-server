import { AttachmentsService } from './attachments.service';
import { rereadable } from './bookkeeping.service';

describe('rereadable — "Re-read all" under Problems (2026-11-11)', () => {
  const s = (over: Record<string, unknown>) =>
    ({ status: 'DONE', source: 'UPLOAD', problem: null, ...over }) as never;

  it('takes failed, set-aside and DONE statements with a fixable problem', () => {
    expect(rereadable(s({ status: 'FAILED' }))).toBe(true);
    expect(rereadable(s({ status: 'NEEDS_REVIEW' }))).toBe(true);
    expect(rereadable(s({ problem: { kind: 'NO_BALANCES' } }))).toBe(true);
    expect(rereadable(s({ problem: { kind: 'MISMATCH' } }))).toBe(true);
  });

  it('never a bank-feed month, a gap, a fine one or one being read', () => {
    expect(rereadable(s({ source: 'PLAID', status: 'FAILED' }))).toBe(false);
    expect(rereadable(s({ problem: { kind: 'MISSING' } }))).toBe(false);
    expect(rereadable(s({}))).toBe(false);
    expect(
      rereadable(s({ status: 'PENDING', problem: { kind: 'MISMATCH' } })),
    ).toBe(false);
  });
});

describe('AttachmentsService.retryAll', () => {
  const scope = { customerId: 7, bookId: 3, companyId: null };
  const make = (
    count: number,
    rows: Array<{ id: number; source: string; sourceRef: string | null }> = [
      { id: 1, source: 'UPLOAD', sourceRef: null },
      { id: 2, source: 'SMS', sourceRef: null },
    ],
    recut?: jest.Mock,
  ) => {
    const updateMany = jest.fn().mockResolvedValue({ count });
    const findMany = jest.fn((args: { where: { id: unknown } }) =>
      Promise.resolve(
        (args.where.id as { in?: number[] }).in
          ? rows
          : rows.filter((r) => r.sourceRef?.startsWith('stmt:')),
      ),
    );
    const processSoon = jest.fn();
    const svc = new AttachmentsService(
      { transactionAttachment: { updateMany, findMany } } as never,
      {} as never,
      {} as never,
      { processSoon } as never,
      undefined,
      recut ? ({ recut } as never) : undefined,
    );
    return { svc, updateMany, processSoon };
  };

  it('only FAILED / UNMATCHED files of this book go back to PENDING', async () => {
    const { svc, updateMany, processSoon } = make(2);
    await expect(svc.retryAll(scope, [1, 2, 3])).resolves.toEqual({
      queued: 2,
    });
    const { where, data } = (
      updateMany.mock.calls[0] as [{ where: unknown; data: unknown }]
    )[0];
    expect(where).toMatchObject({
      id: { in: [1, 2] },
      bookId: 3,
      deletedAt: null,
      status: { in: ['FAILED', 'UNMATCHED'] },
    });
    expect(data).toEqual({ status: 'PENDING', attempts: 0, error: null });
    expect(processSoon).toHaveBeenCalled();
  });

  it("a statement's cheque is cut again from the PDF instead (step2, 2026-11-12)", async () => {
    const recut = jest.fn().mockResolvedValue(true);
    const rows = [
      { id: 5, source: 'STATEMENT', sourceRef: 'stmt:564:p4:1' },
      { id: 6, source: 'STATEMENT', sourceRef: 'doc:5:1' },
      { id: 7, source: 'UPLOAD', sourceRef: null },
    ];
    const { svc, updateMany } = make(1, rows, recut);
    await expect(svc.retryAll(scope, [5, 6, 7])).resolves.toEqual({
      queued: 3,
    });
    // One re-cut for the statement (the sibling goes by its parent), the upload re-read.
    expect(recut).toHaveBeenCalledTimes(1);
    expect(recut).toHaveBeenCalledWith(scope, 564);
    const { where } = (updateMany.mock.calls[0] as [{ where: unknown }])[0];
    expect(where).toMatchObject({ id: { in: [7] } });
  });

  it('a statement that cannot be cut again (deleted / unread) is just re-read', async () => {
    const recut = jest.fn().mockResolvedValue(false);
    const rows = [{ id: 5, source: 'STATEMENT', sourceRef: 'stmt:564:p4:1' }];
    const { svc, updateMany } = make(1, rows, recut);
    await svc.retryAll(scope, [5]);
    const { where } = (updateMany.mock.calls[0] as [{ where: unknown }])[0];
    expect(where).toMatchObject({ id: { in: [5] } });
  });

  it('nothing asked, nothing done', async () => {
    const { svc, updateMany } = make(0);
    await expect(svc.retryAll(scope, [])).resolves.toEqual({ queued: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
