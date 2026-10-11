import type { PrismaService } from '../prisma/prisma.service';
import { NameMemoryService } from './name-memory.service';
import type { TaxService } from './tax.service';

type Tx = {
  id: number;
  description: string;
  name: string | null;
  amount: { toString(): string };
  offsetAccount: string;
  debitAccount: string;
  creditAccount: string;
};

const money = (n: number) => ({ toString: () => n.toFixed(2) });

function fakePrisma(rows: Tx[], existingRule: object | null = null) {
  const updates: Array<{ id: number; data: Record<string, unknown> }> = [];
  const prisma = {
    customerNameRule: {
      findUnique: jest.fn().mockResolvedValue(existingRule),
      upsert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    descriptionMemory: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    customerAccount: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    bankTransaction: {
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          updates.push({ id: where.id, data });
          return { id: where.id };
        },
      ),
    },
    customer: { update: jest.fn(() => ({ taxStale: true })) },
    ledgerName: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
  };
  return { prisma, updates };
}

/** The tax step: re-tags the rows an edit changed (succeeds unless told otherwise). */
const fakeTax = () => ({ retagRows: jest.fn().mockResolvedValue(true) });

const service = (prisma: object, tax = fakeTax()) =>
  new NameMemoryService(
    prisma as unknown as PrismaService,
    tax as unknown as TaxService,
  );

describe('NameMemoryService.saveRule', () => {
  it('rewrites the offset side of money OUT and money IN, and marks taxes stale', async () => {
    const { prisma, updates } = fakePrisma([
      {
        id: 1,
        description: 'WALMART 1',
        name: 'Walmart',
        amount: money(-20),
        offsetAccount: 'Supplies',
        debitAccount: 'Supplies',
        creditAccount: 'BMO 1234',
      },
      {
        id: 2,
        description: 'WALMART REFUND',
        name: 'Walmart',
        amount: money(5),
        offsetAccount: 'Supplies',
        debitAccount: 'BMO 1234',
        creditAccount: 'Supplies',
      },
    ]);
    await service(prisma).saveRule(7, {
      matchType: 'NAME',
      matchKey: 'Walmart',
      name: 'Walmart Canada',
      category: 'Office Expense',
    });
    expect(updates).toEqual([
      {
        id: 1,
        data: {
          name: 'Walmart Canada',
          offsetAccount: 'Office Expense',
          debitAccount: 'Office Expense',
          creditAccount: 'BMO 1234',
        },
      },
      {
        id: 2,
        data: {
          name: 'Walmart Canada',
          offsetAccount: 'Office Expense',
          debitAccount: 'BMO 1234',
          creditAccount: 'Office Expense',
        },
      },
    ]);
    expect(prisma.customerNameRule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          customerId: 7,
          matchType: 'NAME',
          matchKey: 'walmart',
          name: 'Walmart Canada',
          category: 'Office Expense',
        },
      }),
    );
  });

  it('a second edit also reaches rows the first edit renamed', async () => {
    const { prisma } = fakePrisma([], { name: 'Walmart Canada' });
    await service(prisma).saveRule(7, {
      matchType: 'NAME',
      matchKey: 'walmart',
      name: 'WM',
      category: null,
    });
    const [args] = prisma.bankTransaction.findMany.mock.calls[0] as [
      { where: { name: { in: string[] } } },
    ];
    expect([...args.where.name.in].sort()).toEqual([
      'walmart',
      'walmart canada',
    ]);
  });

  it('a DESCRIPTION rule names only the rows whose description matches', async () => {
    const { prisma, updates } = fakePrisma([
      {
        id: 1,
        description: 'SERVICE CHARGE 0923',
        name: null,
        amount: money(-4),
        offsetAccount: 'Uncategorized',
        debitAccount: 'Uncategorized',
        creditAccount: 'BMO 1234',
      },
      {
        id: 2,
        description: 'SERVICE CHARGE 1023',
        name: null,
        amount: money(-4),
        offsetAccount: 'Uncategorized',
        debitAccount: 'Uncategorized',
        creditAccount: 'BMO 1234',
      },
      {
        id: 3,
        description: 'INTEREST 1023',
        name: null,
        amount: money(1),
        offsetAccount: 'Interest Income',
        debitAccount: 'BMO 1234',
        creditAccount: 'Interest Income',
      },
    ]);
    await service(prisma).saveRule(7, {
      matchType: 'DESCRIPTION',
      matchKey: 'service charge',
      name: 'BMO',
      category: 'Bank Fees',
    });
    expect(updates.map((u) => u.id)).toEqual([1, 2]);
    expect(updates[0].data).toEqual({
      name: 'BMO',
      offsetAccount: 'Bank Fees',
      debitAccount: 'Bank Fees',
      creditAccount: 'BMO 1234',
    });
  });

  it('writes nothing (and leaves taxes alone) when no row changes', async () => {
    const { prisma } = fakePrisma([
      {
        id: 1,
        description: 'WALMART',
        name: 'Walmart',
        amount: money(-20),
        offsetAccount: 'Supplies',
        debitAccount: 'Supplies',
        creditAccount: 'BMO 1234',
      },
    ]);
    await service(prisma).saveRule(7, {
      matchType: 'NAME',
      matchKey: 'walmart',
      name: 'Walmart',
      category: 'Supplies',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('re-tags exactly the rows it changed, so the reports are right at once', async () => {
    const { prisma } = fakePrisma([
      {
        id: 1,
        description: 'WALMART 1',
        name: 'Walmart',
        amount: money(-20),
        offsetAccount: 'Supplies',
        debitAccount: 'Supplies',
        creditAccount: 'BMO 1234',
      },
      {
        id: 2,
        description: 'WALMART 2',
        name: 'Walmart',
        amount: money(-5),
        offsetAccount: 'Office Expense',
        debitAccount: 'Office Expense',
        creditAccount: 'BMO 1234',
      },
    ]);
    const tax = fakeTax();
    await service(prisma, tax).saveRule(7, {
      matchType: 'NAME',
      matchKey: 'walmart',
      name: null,
      category: 'Office Expense',
    });
    expect(tax.retagRows).toHaveBeenCalledWith(7, [1]);
    // Re-tagged rather than left for Generate.
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it('a no-change edit re-tags nothing', async () => {
    const { prisma } = fakePrisma([
      {
        id: 1,
        description: 'WALMART',
        name: 'Walmart',
        amount: money(-20),
        offsetAccount: 'Supplies',
        debitAccount: 'Supplies',
        creditAccount: 'BMO 1234',
      },
    ]);
    const tax = fakeTax();
    await service(prisma, tax).saveRule(7, {
      matchType: 'NAME',
      matchKey: 'walmart',
      name: 'Walmart',
      category: 'Supplies',
    });
    expect(tax.retagRows).not.toHaveBeenCalled();
  });
});

describe('NameMemoryService.resolveStatement', () => {
  it("keeps the AI's answers when the memory cannot be reached", async () => {
    const { prisma } = fakePrisma([]);
    prisma.descriptionMemory.findMany.mockRejectedValue(new Error('db down'));
    const rows = [
      {
        pendingDate: null,
        postingDate: null,
        description: 'WALMART',
        name: 'Walmart',
        amount: -1,
        balanceAfter: null,
        offsetAccount: 'Supplies',
      },
    ];
    expect((await service(prisma).resolveStatement(7, rows)).lines).toBe(rows);
  });

  it('applies the memory and learns new descriptions', async () => {
    const { prisma } = fakePrisma([]);
    prisma.descriptionMemory.findMany.mockResolvedValue([
      { descriptionKey: 'walmart', name: 'Walmart', category: 'Supplies' },
    ]);
    const out = await service(prisma).resolveStatement(7, [
      {
        pendingDate: null,
        postingDate: null,
        description: 'WALMART',
        name: 'Wal-Mart',
        amount: -1,
        balanceAfter: null,
        offsetAccount: 'Office Expense',
      },
      {
        pendingDate: null,
        postingDate: null,
        description: 'STAPLES 12',
        name: 'Staples',
        amount: -2,
        balanceAfter: null,
        offsetAccount: 'Office Expense',
      },
    ]);
    expect(out.lines.map((r) => [r.name, r.offsetAccount])).toEqual([
      ['Walmart', 'Supplies'],
      ['Staples', 'Office Expense'],
    ]);
    expect(prisma.descriptionMemory.createMany).toHaveBeenCalledWith({
      data: [
        {
          descriptionKey: 'staples',
          sampleDescription: 'STAPLES 12',
          name: 'Staples',
          category: 'Office Expense',
        },
      ],
      skipDuplicates: true,
    });
    expect(prisma.descriptionMemory.updateMany).toHaveBeenCalledWith({
      where: { descriptionKey: { in: ['walmart'] } },
      data: { hits: { increment: 1 } },
    });
  });
});

describe('one time vs always', () => {
  const walmart = (id: number, manual = false) => ({
    id,
    description: `WALMART ${id}`,
    name: 'Walmart',
    amount: money(-20),
    offsetAccount: 'Supplies',
    debitAccount: 'Supplies',
    creditAccount: 'BMO 1234',
    manualEdit: manual,
  });

  it('ONCE changes the rows and flags them, but saves no rule', async () => {
    const { prisma, updates } = fakePrisma([walmart(1), walmart(2)]);
    await service(prisma).saveRule(7, {
      matchType: 'NAME',
      matchKey: 'walmart',
      name: null,
      category: 'Office Expense',
      scope: 'ONCE',
    });
    expect(prisma.customerNameRule.upsert).not.toHaveBeenCalled();
    expect(updates.map((u) => u.data.manualEdit)).toEqual([true, true]);
    // A one-time change reaches rows an earlier one-time change touched.
    const [args] = prisma.bankTransaction.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).not.toHaveProperty('manualEdit');
  });

  it('ALWAYS never touches a row a one-time edit flagged', async () => {
    const { prisma } = fakePrisma([walmart(1)]);
    await service(prisma).saveRule(7, {
      matchType: 'NAME',
      matchKey: 'walmart',
      name: null,
      category: 'Office Expense',
    });
    const [args] = prisma.bankTransaction.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(args.where.manualEdit).toBe(false);
  });

  it('a ledger ONCE edit changes only that row, with debit/credit re-derived', async () => {
    const { prisma, updates } = fakePrisma([]);
    prisma.bankTransaction.findFirst.mockResolvedValue({
      ...walmart(5),
      amount: money(30),
      debitAccount: 'BMO 1234',
      creditAccount: 'Supplies',
    });
    await service(prisma).editTransaction(7, 5, {
      name: 'Walmart Refund',
      category: 'Other Income',
      scope: 'ONCE',
    });
    expect(updates).toEqual([
      {
        id: 5,
        data: {
          name: 'Walmart Refund',
          offsetAccount: 'Other Income',
          debitAccount: 'BMO 1234',
          creditAccount: 'Other Income',
          manualEdit: true,
        },
      },
    ]);
    expect(prisma.customerNameRule.upsert).not.toHaveBeenCalled();
  });

  it('a ledger ALWAYS edit saves a rule for the payee', async () => {
    const { prisma } = fakePrisma([]);
    prisma.bankTransaction.findFirst.mockResolvedValue(walmart(5));
    await service(prisma).editTransaction(7, 5, {
      name: null,
      category: 'Office Expense',
      scope: 'ALWAYS',
    });
    const [upsert] = prisma.customerNameRule.upsert.mock.calls[0] as [
      { create: { matchType: string; matchKey: string; category: string } },
    ];
    expect(upsert.create).toMatchObject({
      matchType: 'NAME',
      matchKey: 'walmart',
      category: 'Office Expense',
    });
  });

  it("keeps the customer's own category instead of turning it into Uncategorized", async () => {
    const { prisma, updates } = fakePrisma([walmart(1)]);
    prisma.customerAccount.findMany.mockResolvedValue([{ name: 'Groceries' }]);
    await service(prisma).saveRule(7, {
      matchType: 'NAME',
      matchKey: 'walmart',
      name: null,
      category: 'groceries',
    });
    expect(updates[0].data.offsetAccount).toBe('Groceries');
  });

  it('a ledger edit of a row that is not theirs is a 404', async () => {
    const { prisma } = fakePrisma([]);
    await expect(
      service(prisma).editTransaction(7, 99, {
        name: 'X',
        category: null,
        scope: 'ONCE',
      }),
    ).rejects.toThrow('Transaction not found');
  });
});
