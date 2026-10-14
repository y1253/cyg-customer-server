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
  manualEdit?: boolean;
  splitOfId?: number | null;
};

const money = (n: number) => ({ toString: () => n.toFixed(2) });

type Where = {
  name?: string | { in: string[] };
  manualEdit?: boolean;
  splitOfId?: null;
};

/** MySQL compares names case-insensitively; so does this fake. */
function matches(row: Tx, where: Where): boolean {
  const n = row.name?.toLowerCase() ?? null;
  if (typeof where.name === 'string' && n !== where.name.toLowerCase()) {
    return false;
  }
  if (
    where.name &&
    typeof where.name === 'object' &&
    !where.name.in.some((x) => x.toLowerCase() === n)
  ) {
    return false;
  }
  if (where.manualEdit === false && row.manualEdit) return false;
  if (where.splitOfId === null && row.splitOfId) return false;
  return true;
}

/** A Prisma stand-in whose rows CHANGE with each update, so multi-step edits read true. */
function fakePrisma(rows: Tx[], existingRule: object | null = null) {
  const updates: Array<{ id: number; data: Record<string, unknown> }> = [];
  const prisma = {
    customerNameRule: {
      findUnique: jest.fn().mockResolvedValue(existingRule),
      upsert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    nameMemory: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn(),
      updateMany: jest.fn(),
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
      findMany: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(rows.filter((r) => matches(r, where))),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([]),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          updates.push({ id: where.id, data });
          const row = rows.find((r) => r.id === where.id);
          if (row) Object.assign(row, data);
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
  return { prisma, updates, rows };
}

/** The tax step: re-tags the rows an edit changed (succeeds unless told otherwise). */
const fakeTax = () => ({ retagRows: jest.fn().mockResolvedValue(true) });

const service = (prisma: object, tax = fakeTax()) =>
  new NameMemoryService(
    prisma as unknown as PrismaService,
    tax as unknown as TaxService,
  );

/** What a row ends up as: name, category, debit, credit. */
const state = (r: Tx) => [
  r.name,
  r.offsetAccount,
  r.debitAccount,
  r.creditAccount,
];

describe('NameMemoryService.saveRule', () => {
  it('a payee rename + category moves every row of the name, both money OUT and IN', async () => {
    const { prisma, rows } = fakePrisma([
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
    expect(rows.map(state)).toEqual([
      ['Walmart Canada', 'Office Expense', 'Office Expense', 'BMO 1234'],
      ['Walmart Canada', 'Office Expense', 'BMO 1234', 'Office Expense'],
    ]);
    expect(prisma.customerNameRule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          customerId: 7,
          matchType: 'NAME',
          matchKey: 'walmart',
          name: 'Walmart Canada',
        },
      }),
    );
    // The category is the NEW name's, kept on a rule for that name.
    expect(prisma.customerNameRule.create).toHaveBeenCalledWith({
      data: {
        customerId: 7,
        matchType: 'NAME',
        matchKey: 'walmart canada',
        category: 'Office Expense',
      },
    });
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
    const { prisma, rows } = fakePrisma([
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
    expect(rows.map(state)).toEqual([
      ['BMO', 'Bank Fees', 'Bank Fees', 'BMO 1234'],
      ['BMO', 'Bank Fees', 'Bank Fees', 'BMO 1234'],
      [null, 'Interest Income', 'BMO 1234', 'Interest Income'],
    ]);
  });

  it('a nameless description gets its own category, and only its nameless rows move', async () => {
    const { prisma, rows } = fakePrisma([
      {
        id: 1,
        description: 'DEPOSIT 0923',
        name: null,
        amount: money(40),
        offsetAccount: 'Uncategorized',
        debitAccount: 'BMO 1234',
        creditAccount: 'Uncategorized',
        manualEdit: true,
      },
      {
        id: 2,
        description: 'DEPOSIT 1023',
        name: 'Acme',
        amount: money(40),
        offsetAccount: 'Sales Income',
        debitAccount: 'BMO 1234',
        creditAccount: 'Sales Income',
      },
    ]);
    await service(prisma).saveRule(7, {
      matchType: 'DESCRIPTION',
      matchKey: 'deposit',
      name: null,
      category: 'Other Income',
    });
    expect(rows.map((r) => r.offsetAccount)).toEqual([
      'Other Income',
      'Sales Income',
    ]);
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
    const tax = fakeTax();
    await service(prisma, tax).saveRule(7, {
      matchType: 'NAME',
      matchKey: 'walmart',
      name: 'Walmart',
      category: 'Supplies',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tax.retagRows).not.toHaveBeenCalled();
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
    expect((await service(prisma).resolveStatement(7, rows)).lines).toEqual(
      rows,
    );
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

describe('one category per name; "Always / Only this row" is for the name', () => {
  const walmart = (id: number, manual = false): Tx => ({
    id,
    description: `WALMART ${id}`,
    name: 'Walmart',
    amount: money(-20),
    offsetAccount: 'Supplies',
    debitAccount: 'Supplies',
    creditAccount: 'BMO 1234',
    manualEdit: manual,
  });

  it('a category reaches EVERY row of the name — one-time edits too, splits never', async () => {
    const split = { ...walmart(3), splitOfId: 1 };
    const { prisma, rows } = fakePrisma([walmart(1), walmart(2, true), split]);
    await service(prisma).saveRule(7, {
      matchType: 'NAME',
      matchKey: 'walmart',
      name: null,
      category: 'Office Expense',
      // The Names tab never sends ONCE for a payee any more; it is ignored if it does.
      scope: 'ONCE',
    });
    expect(rows.map((r) => r.offsetAccount)).toEqual([
      'Office Expense',
      'Office Expense',
      'Supplies',
    ]);
  });

  it('a payee rename skips rows a one-time rename flagged', async () => {
    const { prisma, rows } = fakePrisma([walmart(1), walmart(2, true)]);
    await service(prisma).saveRule(7, {
      matchType: 'NAME',
      matchKey: 'walmart',
      name: 'Walmart Canada',
      category: null,
    });
    expect(rows.map((r) => r.name)).toEqual(['Walmart Canada', 'Walmart']);
  });

  it('an unrecognised group ONCE names the rows there now and saves no rule', async () => {
    const { prisma, updates } = fakePrisma([
      { ...walmart(1), name: null, description: 'POS 0923' },
      { ...walmart(2), name: null, description: 'POS 1023' },
    ]);
    await service(prisma).saveRule(7, {
      matchType: 'DESCRIPTION',
      matchKey: 'pos',
      name: 'Corner Store',
      category: null,
      scope: 'ONCE',
    });
    expect(prisma.customerNameRule.upsert).not.toHaveBeenCalled();
    expect(updates.map((u) => [u.data.name, u.data.manualEdit])).toEqual([
      ['Corner Store', true],
      ['Corner Store', true],
    ]);
  });

  it('a ledger ONCE rename changes only that row; the category goes to the new name', async () => {
    const row5 = {
      ...walmart(5),
      amount: money(30),
      debitAccount: 'BMO 1234',
      creditAccount: 'Supplies',
    };
    const { prisma, rows } = fakePrisma([row5, walmart(6)]);
    prisma.bankTransaction.findFirst.mockResolvedValue({ ...row5 });
    await service(prisma).editTransaction(7, 5, {
      name: 'Walmart Refund',
      category: 'Other Income',
      scope: 'ONCE',
    });
    expect(rows.map(state)).toEqual([
      ['Walmart Refund', 'Other Income', 'BMO 1234', 'Other Income'],
      ['Walmart', 'Supplies', 'Supplies', 'BMO 1234'],
    ]);
    expect(rows[0].manualEdit).toBe(true);
    expect(prisma.customerNameRule.upsert).not.toHaveBeenCalled();
    expect(prisma.customerNameRule.create).toHaveBeenCalledWith({
      data: {
        customerId: 7,
        matchType: 'NAME',
        matchKey: 'walmart refund',
        category: 'Other Income',
      },
    });
  });

  it('a ledger ALWAYS rename names every row with that description (a DESCRIPTION rule)', async () => {
    const { prisma } = fakePrisma([]);
    prisma.bankTransaction.findFirst.mockResolvedValue(walmart(5));
    await service(prisma).editTransaction(7, 5, {
      name: 'Walmart Canada',
      category: null,
      scope: 'ALWAYS',
    });
    const [upsert] = prisma.customerNameRule.upsert.mock.calls[0] as [
      { create: Record<string, unknown> },
    ];
    expect(upsert.create).toMatchObject({
      matchType: 'DESCRIPTION',
      matchKey: 'walmart',
      name: 'Walmart Canada',
    });
  });

  it("a ledger category edit is the NAME's category, whatever the scope", async () => {
    const { prisma, rows } = fakePrisma([walmart(5), walmart(6, true)]);
    prisma.bankTransaction.findFirst.mockResolvedValue(walmart(5));
    await service(prisma).editTransaction(7, 5, {
      name: null,
      category: 'Office Expense',
      scope: 'ONCE',
    });
    expect(rows.map((r) => r.offsetAccount)).toEqual([
      'Office Expense',
      'Office Expense',
    ]);
    expect(prisma.customerNameRule.create).toHaveBeenCalledWith({
      data: {
        customerId: 7,
        matchType: 'NAME',
        matchKey: 'walmart',
        category: 'Office Expense',
      },
    });
  });

  it('a renamed row takes the category its new name already has', async () => {
    const { prisma, rows } = fakePrisma([walmart(5)]);
    prisma.bankTransaction.findFirst.mockResolvedValue(walmart(5));
    prisma.nameMemory.findUnique.mockResolvedValue({
      category: 'Meals & Entertainment',
    });
    await service(prisma).editTransaction(7, 5, {
      name: 'Tim Hortons',
      category: null,
      scope: 'ONCE',
    });
    expect(state(rows[0])).toEqual([
      'Tim Hortons',
      'Meals & Entertainment',
      'Meals & Entertainment',
      'BMO 1234',
    ]);
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
