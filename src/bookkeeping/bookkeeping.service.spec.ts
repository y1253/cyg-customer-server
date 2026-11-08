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
import type { BookScope } from './scope';

const BOOK: BookScope = { customerId: 7, companyId: null };

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
    await expect(service.remove(BOOK, 99)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.bankStatement.findFirst).toHaveBeenCalledWith({
      where: { id: 99, customerId: 7, companyId: null, deletedAt: null },
    });
    expect(prisma.bankStatement.update).not.toHaveBeenCalled();
  });

  it("a company's books ask only for that company's statement", async () => {
    const { service, prisma } = setup(null);
    await expect(
      service.remove({ customerId: 7, companyId: 3 }, 99),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.bankStatement.findFirst).toHaveBeenCalledWith({
      where: { id: 99, customerId: 7, companyId: 3, deletedAt: null },
    });
  });

  it('never retries a statement still being read', async () => {
    const { service } = setup({
      id: 1,
      customerId: 7,
      status: StatementStatus.PROCESSING,
      source: 'UPLOAD',
    });
    await expect(service.retry(BOOK, 1)).rejects.toThrow(
      'still waiting or being read',
    );
  });

  it('step2: re-reads a DONE statement with the note, clearing the old error', async () => {
    const row = {
      id: 1,
      customerId: 7,
      status: StatementStatus.DONE,
      source: 'UPLOAD',
      filename: 'td.pdf',
    };
    const { service, prisma } = setup(row);
    await service.retry(BOOK, 1, ' page 2 is a card ');
    expect(prisma.bankStatement.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        status: StatementStatus.PENDING,
        error: null,
        errorDetail: null,
        customerNote: 'page 2 is a card',
      }) as unknown,
    });
  });

  it('step2: never re-reads a bank-feed month', async () => {
    const { service, prisma } = setup({
      id: 1,
      customerId: 7,
      status: StatementStatus.DONE,
      source: 'PLAID',
    });
    await expect(service.retry(BOOK, 1)).rejects.toThrow('bank-feed month');
    expect(prisma.bankStatement.update).not.toHaveBeenCalled();
  });
});

describe('BookkeepingService.setBalances (step2)', () => {
  function balanceSetup(statement: Record<string, unknown>, net = 0) {
    const prisma = {
      bankStatement: {
        findFirst: jest.fn().mockResolvedValue(statement),
        update: jest
          .fn()
          .mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => ({
              ...statement,
              ...data,
            }),
          ),
      },
      bankTransaction: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: net } }),
      },
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
    return { service, prisma };
  }
  const done = {
    id: 4,
    customerId: 7,
    status: StatementStatus.DONE,
    source: 'UPLOAD',
    filename: 'td.pdf',
    accountName: 'TD 5234',
    accountKind: 'BANK',
    openingBalance: 100,
    closingBalance: 150,
    customerNote: null,
  };

  it('writes the balance, keeps the reason for re-reads, and says if it now adds up', async () => {
    const { service, prisma } = balanceSetup(done, 25);
    const r = await service.setBalances(BOOK, 4, {
      openingBalance: 125,
      reason: 'the opening is $125, not $100',
    });
    expect(prisma.bankStatement.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: {
        openingBalance: '125.00',
        customerNote:
          'The opening balance is 125.00 (customer: the opening is $125, not $100)',
      },
    });
    expect(r.balancesMatch).toBe(true);
    expect(r.expectedClosing).toBe(150);
  });

  it('refuses a bank-feed month and a statement not read yet', async () => {
    await expect(
      balanceSetup({ ...done, source: 'PLAID' }).service.setBalances(BOOK, 4, {
        openingBalance: 1,
        reason: 'x',
      }),
    ).rejects.toThrow('bank-feed');
    await expect(
      balanceSetup({
        ...done,
        status: StatementStatus.FAILED,
      }).service.setBalances(BOOK, 4, { openingBalance: 1, reason: 'x' }),
    ).rejects.toThrow('retry_statement');
  });

  it('needs a balance', async () => {
    await expect(
      balanceSetup(done).service.setBalances(BOOK, 4, { reason: 'x' }),
    ).rejects.toThrow('opening or the closing');
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
        findFirst: jest.fn().mockResolvedValue(opts.kept ?? null),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
      customerAccountCurrency: {
        findFirst: jest.fn().mockResolvedValue(null),
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
    const view = await service.moveStatement(BOOK, 5, '  BMO   2304 ');
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
    await service.moveStatement(BOOK, 5, 'BMO 2304');
    expect(tx.customerAccountType.updateMany).toHaveBeenCalledWith({
      where: { customerId: 7, companyId: null, account: 'TD 5234' },
      data: { account: 'BMO 2304' },
    });
    expect(tx.customerAccountCurrency.updateMany).toHaveBeenCalledWith({
      where: { customerId: 7, companyId: null, account: 'TD 5234' },
      data: { account: 'BMO 2304' },
    });
  });

  it('leaves the override while other statements still use the old name', async () => {
    const { service, tx } = moveSetup(stmt, { left: 2 });
    await service.moveStatement(BOOK, 5, 'BMO 2304');
    expect(tx.customerAccountType.updateMany).not.toHaveBeenCalled();
    expect(tx.customerAccountType.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a statement that has not been read', async () => {
    const { service } = moveSetup({ ...stmt, status: StatementStatus.FAILED });
    await expect(service.moveStatement(BOOK, 5, 'X')).rejects.toThrow(
      'Only a statement that has been read can be moved',
    );
  });
});
