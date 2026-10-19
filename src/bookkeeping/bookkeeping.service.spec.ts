import { NotFoundException } from '@nestjs/common';
import { StatementStatus } from '@prisma/client';
import type { OpenAiClient } from '../ai/openai.client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import { BookkeepingService } from './bookkeeping.service';
import type { FxService } from './fx.service';
import type { StatementImagesService } from './statement-images.service';
import type { StatementProcessorService } from './statement-processor.service';
import type { TaxService } from './tax.service';
import { claimableAt } from './statement-processor.service';

function setup(found: unknown = null) {
  const prisma = {
    bankStatement: {
      findFirst: jest.fn().mockResolvedValue(found),
      update: jest.fn().mockResolvedValue(found),
    },
  };
  const service = new BookkeepingService(
    prisma as unknown as PrismaService,
    {} as ObjectStorageService,
    {} as OpenAiClient,
    { processSoon: jest.fn() } as unknown as StatementProcessorService,
    {} as TaxService,
    {
      removeFor: jest.fn().mockResolvedValue(undefined),
    } as unknown as StatementImagesService,
    {} as FxService,
  );
  return { service, prisma };
}

describe('BookkeepingService ownership', () => {
  it("answers 404 for another customer's statement, and only ever asks for the caller's", async () => {
    const { service, prisma } = setup(null);
    await expect(service.remove(7, 99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.bankStatement.findFirst).toHaveBeenCalledWith({
      where: { id: 99, customerId: 7, deletedAt: null },
    });
    expect(prisma.bankStatement.update).not.toHaveBeenCalled();
  });

  it('retries only a FAILED statement', async () => {
    const { service } = setup({
      id: 1,
      customerId: 7,
      status: StatementStatus.DONE,
    });
    await expect(service.retry(7, 1)).rejects.toThrow(
      'Only a statement that failed',
    );
  });
});

describe('claimableAt backoff', () => {
  const t = new Date('2026-10-07T12:00:00Z');
  it('a fresh upload is claimable at once; failures wait 1m, 5m, 30m', () => {
    expect(claimableAt(t, 0)).toBe(t.getTime());
    expect(claimableAt(t, 1) - t.getTime()).toBe(60_000);
    expect(claimableAt(t, 2) - t.getTime()).toBe(5 * 60_000);
    expect(claimableAt(t, 3) - t.getTime()).toBe(30 * 60_000);
    expect(claimableAt(t, 9) - t.getTime()).toBe(30 * 60_000);
  });
});

describe('BookkeepingService.moveStatement', () => {
  function moveSetup(
    statement: Record<string, unknown>,
    opts: { target?: unknown; left?: number; kept?: unknown } = {},
  ) {
    const tx = {
      bankTransaction: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bankStatement: {
        update: jest.fn().mockImplementation(({ data }: { data: object }) => ({
          ...statement,
          ...data,
        })),
        count: jest.fn().mockResolvedValue(opts.left ?? 0),
      },
      customerAccountType: {
        findUnique: jest.fn().mockResolvedValue(opts.kept ?? null),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
      customerAccountCurrency: {
        findUnique: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      bankStatement: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(statement)
          .mockResolvedValueOnce(opts.target ?? null),
      },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const service = new BookkeepingService(
      prisma as unknown as PrismaService,
      {} as ObjectStorageService,
      {} as OpenAiClient,
      {} as StatementProcessorService,
      {} as TaxService,
      {} as StatementImagesService,
      {} as FxService,
    );
    return { service, tx };
  }

  const stmt = {
    id: 5,
    customerId: 7,
    status: StatementStatus.DONE,
    accountName: 'TD 5234',
    accountNameByCustomer: null,
    accountKind: 'BANK',
    periodStart: null,
    periodEnd: null,
    filename: 'a.pdf',
  };

  it('rewrites only the bank side of its own rows and remembers the choice', async () => {
    const { service, tx } = moveSetup(stmt, {
      target: { accountKind: 'CREDIT_CARD' },
    });
    const view = await service.moveStatement(7, 5, '  BMO   2304 ');
    expect(tx.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: { statementId: 5, amount: { lt: 0 } },
      data: { creditAccount: 'BMO 2304' },
    });
    expect(tx.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: { statementId: 5, amount: { gte: 0 } },
      data: { debitAccount: 'BMO 2304' },
    });
    expect(tx.bankStatement.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        accountName: 'BMO 2304',
        accountNameByCustomer: 'BMO 2304',
        accountKind: 'CREDIT_CARD',
      },
    });
    expect(view.movedByCustomer).toBe(true);
  });

  it('carries the old account section override when its last statement leaves', async () => {
    const { service, tx } = moveSetup(stmt, { left: 0 });
    await service.moveStatement(7, 5, 'BMO 2304');
    expect(tx.customerAccountType.updateMany).toHaveBeenCalledWith({
      where: { customerId: 7, account: 'TD 5234' },
      data: { account: 'BMO 2304' },
    });
    expect(tx.customerAccountCurrency.updateMany).toHaveBeenCalledWith({
      where: { customerId: 7, account: 'TD 5234' },
      data: { account: 'BMO 2304' },
    });
  });

  it('leaves the override while other statements still use the old name', async () => {
    const { service, tx } = moveSetup(stmt, { left: 2 });
    await service.moveStatement(7, 5, 'BMO 2304');
    expect(tx.customerAccountType.updateMany).not.toHaveBeenCalled();
    expect(tx.customerAccountType.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a statement that has not been read', async () => {
    const { service } = moveSetup({ ...stmt, status: StatementStatus.FAILED });
    await expect(service.moveStatement(7, 5, 'X')).rejects.toThrow(
      'Only a statement that has been read can be moved',
    );
  });
});
