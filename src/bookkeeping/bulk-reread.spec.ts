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
  const make = (count: number) => {
    const updateMany = jest.fn().mockResolvedValue({ count });
    const processSoon = jest.fn();
    const svc = new AttachmentsService(
      { transactionAttachment: { updateMany } } as never,
      {} as never,
      {} as never,
      { processSoon } as never,
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
      id: { in: [1, 2, 3] },
      bookId: 3,
      deletedAt: null,
      status: { in: ['FAILED', 'UNMATCHED'] },
    });
    expect(data).toEqual({ status: 'PENDING', attempts: 0, error: null });
    expect(processSoon).toHaveBeenCalled();
  });

  it('nothing asked, nothing done', async () => {
    const { svc, updateMany } = make(0);
    await expect(svc.retryAll(scope, [])).resolves.toEqual({ queued: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
