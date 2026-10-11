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

describe('TaxService tagging keeps what the customer did', () => {
  function tagSetup() {
    const created: unknown[] = [];
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ salesTaxEnabled: true }),
        update: jest.fn().mockResolvedValue({}),
      },
      taxAgency: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 5, name: 'GST', rates: [{ kind: 'PURCHASE', rate: 5 }] },
          ]),
      },
      bankTransaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            description: 'STAPLES',
            name: 'Staples',
            amount: -105,
            offsetAccount: 'Office Expense',
            splitOfId: null,
          },
        ]),
        // $42 of the $105 was split off by hand.
        groupBy: jest
          .fn()
          .mockResolvedValue([{ splitOfId: 1, _sum: { amount: -42 } }]),
      },
      transactionTax: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { transactionId: 1, agencyId: 5, name: 'GST paid' },
          ]),
        deleteMany: jest.fn().mockReturnValue('delete'),
        createMany: jest.fn((args: { data: unknown[] }) => {
          created.push(...args.data);
          return 'create';
        }),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const openai = {
      chat: jest
        .fn()
        .mockResolvedValue(
          JSON.stringify({ rows: [{ id: 1, agencyIds: [5] }] }),
        ),
    };
    const tax = new TaxService(
      prisma as unknown as PrismaService,
      openai as unknown as OpenAiClient,
      { get: () => undefined } as unknown as ConfigService,
      {
        types: jest.fn().mockResolvedValue(new Map()),
      } as unknown as CustomerAccountsService,
    );
    return { tax, created };
  }

  it("a tax line's own name survives the rebuild, and a split parent is taxed on what is left", async () => {
    const { tax, created } = tagSetup();
    expect(await tax.retagRows(7, [1])).toBe(true);
    expect(created).toEqual([
      expect.objectContaining({
        transactionId: 1,
        agencyId: 5,
        name: 'GST paid',
        // 5% included in the $63 left: 63 × 5 / 105.
        amount: '3.00',
      }),
    ]);
  });
});
