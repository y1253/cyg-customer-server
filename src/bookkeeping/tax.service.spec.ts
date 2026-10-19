import type { PrismaService } from '../prisma/prisma.service';
import type { CustomerAccountsService } from './customer-accounts.service';
import { TaxService } from './tax.service';

/** A customer with one Staples purchase of $105, $42 of it split off by hand. */
function setup(picks: Array<{ name: string; agencyId: number }>) {
  const prisma = {
    ledgerNameAgency: { findMany: jest.fn().mockResolvedValue(picks) },
    taxAgency: {
      findMany: jest.fn().mockResolvedValue([
        { id: 5, name: 'GST', rates: [{ kind: 'PURCHASE', rate: 5 }] },
        { id: 6, name: 'QST', rates: [{ kind: 'SALES', rate: 9.975 }] },
      ]),
    },
    bankTransaction: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 1,
          name: 'Staples',
          amount: -105,
          offsetAccount: 'Office Expense',
          splitOfId: null,
        },
        {
          id: 2,
          name: 'Staples',
          amount: -42,
          offsetAccount: 'Supplies',
          splitOfId: 1,
        },
      ]),
    },
    transactionTax: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { transactionId: 1, agencyId: 5, name: 'GST paid' },
        ]),
    },
  };
  const accounts = {
    types: jest.fn().mockResolvedValue(new Map()),
    overrides: jest.fn().mockResolvedValue(new Map()),
  };
  const tax = new TaxService(
    prisma as unknown as PrismaService,
    accounts as unknown as CustomerAccountsService,
  );
  return { tax, prisma };
}

describe('TaxService.linesFor (tax decided per name, on read)', () => {
  it('a name with no agencies is not taxed — and nothing else is loaded', async () => {
    const { tax, prisma } = setup([]);
    expect((await tax.linesFor({ customerId: 7, companyId: null })).size).toBe(
      0,
    );
    expect(prisma.bankTransaction.findMany).not.toHaveBeenCalled();
  });

  it("taxes the name's rows by kind, keeps a line's own name, and a split parent on what is left", async () => {
    const { tax } = setup([{ name: 'STAPLES', agencyId: 5 }]);
    const lines = await tax.linesFor({ customerId: 7, companyId: null });
    // QST has no purchase rate: only GST taxes these purchases.
    expect(lines.get(1)).toEqual([
      {
        agencyId: 5,
        agency: 'GST',
        kind: 'PURCHASE',
        rate: 5,
        name: 'GST paid',
        // 5% included in the $63 left: 63 × 5 / 105.
        amount: 3,
      },
    ]);
    expect(lines.get(2)).toEqual([
      expect.objectContaining({ agencyId: 5, name: null, amount: 2 }),
    ]);
  });
});
