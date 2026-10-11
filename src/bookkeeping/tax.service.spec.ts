import type { ConfigService } from '@nestjs/config';
import type { OpenAiClient } from '../ai/openai.client';
import type { PrismaService } from '../prisma/prisma.service';
import type { CustomerAccountsService } from './customer-accounts.service';
import { TaxService } from './tax.service';

function setup(salesTaxEnabled: boolean) {
  const prisma = {
    customer: {
      findUnique: jest.fn().mockResolvedValue({ salesTaxEnabled }),
      update: jest.fn().mockResolvedValue({}),
    },
    taxAgency: { findMany: jest.fn().mockRejectedValue(new Error('db down')) },
    bankTransaction: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const tax = new TaxService(
    prisma as unknown as PrismaService,
    {} as OpenAiClient,
    { get: () => undefined } as unknown as ConfigService,
    {
      types: jest.fn().mockResolvedValue(new Map()),
    } as unknown as CustomerAccountsService,
  );
  return { tax, prisma };
}

describe('TaxService.retagRows (after a customer edit)', () => {
  it('does nothing when sales tax is off', async () => {
    const { tax, prisma } = setup(false);
    expect(await tax.retagRows(7, [1, 2])).toBe(true);
    expect(prisma.taxAgency.findMany).not.toHaveBeenCalled();
  });

  it('does nothing for no rows', async () => {
    const { tax, prisma } = setup(true);
    expect(await tax.retagRows(7, [])).toBe(true);
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it('a failure never throws, and leaves the "Generate" hint', async () => {
    const { tax, prisma } = setup(true);
    expect(await tax.retagRows(7, [1])).toBe(false);
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { taxStale: true },
    });
  });
});
