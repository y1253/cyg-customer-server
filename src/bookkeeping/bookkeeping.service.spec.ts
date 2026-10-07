import { NotFoundException } from '@nestjs/common';
import { StatementStatus } from '@prisma/client';
import type { OpenAiClient } from '../ai/openai.client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ObjectStorageService } from '../storage/object-storage.service';
import { BookkeepingService } from './bookkeeping.service';
import type { StatementProcessorService } from './statement-processor.service';
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
