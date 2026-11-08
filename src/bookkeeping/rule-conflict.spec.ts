import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { NameMemoryService } from './name-memory.service';
import {
  findLinkConflicts,
  linkConflictMessage,
  RULE_CONFLICT,
  type NameRule,
} from './name-memory.util';
import type { TaxService } from './tax.service';

/** step2 (2026-11-08): a description already linked to another name is never moved silently. */

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

type Rule = {
  id: number;
  matchType: string;
  matchKey: string;
  name: string | null;
  category: string | null;
  includeChars?: string | null;
};

const money = (n: number) => ({ toString: () => n.toFixed(2) });

const tx = (id: number, description: string, name: string): Tx => ({
  id,
  description,
  name,
  amount: money(-20),
  offsetAccount: 'Supplies',
  debitAccount: 'Supplies',
  creditAccount: 'BMO 1234',
});

type RuleWhere = { matchType?: string | { in: string[] }; matchKey?: string };

const ruleMatches = (r: Rule, where: RuleWhere): boolean => {
  const t = where.matchType;
  if (typeof t === 'string' && r.matchType !== t) return false;
  if (t && typeof t === 'object' && !t.in.includes(r.matchType)) return false;
  if (where.matchKey !== undefined && r.matchKey !== where.matchKey) {
    return false;
  }
  return true;
};

/** A Prisma stand-in holding the book's rules and rows; both change with each write. */
function fakePrisma(rows: Tx[], rules: Rule[]) {
  const prisma = {
    customerNameRule: {
      findMany: jest.fn(({ where }: { where: RuleWhere }) =>
        Promise.resolve(rules.filter((r) => ruleMatches(r, where))),
      ),
      findFirst: jest.fn(({ where }: { where: RuleWhere }) =>
        Promise.resolve(rules.find((r) => ruleMatches(r, where)) ?? null),
      ),
      create: jest.fn(({ data }: { data: Rule }) => {
        rules.push({ ...data, id: 100 + rules.length });
        return {};
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: number }; data: Partial<Rule> }) => {
          const r = rules.find((x) => x.id === where.id);
          if (r) Object.assign(r, data);
          return {};
        },
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn(({ where }: { where: { id: { in: number[] } } }) => {
        for (const id of where.id.in) {
          const i = rules.findIndex((r) => r.id === id);
          if (i >= 0) rules.splice(i, 1);
        }
        return { count: where.id.in.length };
      }),
    },
    nameMemory: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    descriptionMemory: { findMany: jest.fn().mockResolvedValue([]) },
    customerAccount: { findMany: jest.fn().mockResolvedValue([]) },
    bankTransaction: {
      findMany: jest.fn(
        ({ where }: { where: { manualEdit?: boolean; name?: unknown } }) =>
          Promise.resolve(
            rows.filter(
              (r) =>
                !(where.manualEdit === false && r.manualEdit) &&
                (typeof where.name !== 'string' ||
                  r.name?.toLowerCase() === where.name),
            ),
          ),
      ),
      findFirst: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
      ),
      groupBy: jest.fn().mockResolvedValue([]),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          const row = rows.find((r) => r.id === where.id);
          if (row) Object.assign(row, data);
          return { id: where.id };
        },
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ledgerName: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
  };
  return { prisma, rows, rules };
}

const service = (prisma: object) =>
  new NameMemoryService(
    prisma as unknown as PrismaService,
    { carryAgencies: jest.fn() } as unknown as TaxService,
  );

const BOOK = { customerId: 7, bookId: 1, companyId: null };

/** The 409 a save threw, or null. */
async function conflictOf(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    if (!(e instanceof ConflictException)) throw e;
    return e.getResponse() as {
      code: string;
      message: string;
      conflicts: Array<{ matchType: string; text: string; name: string }>;
    };
  }
}

describe('findLinkConflicts', () => {
  const rule = (
    r: Partial<NameRule> & Pick<NameRule, 'matchType' | 'matchKey'>,
  ) => ({ id: 1, name: null, category: null, ...r }) as NameRule;

  it('an exact description linked to another name', () => {
    const out = findLinkConflicts({
      matchType: 'DESCRIPTION',
      key: 'amzn mktp',
      name: 'Staples',
      rules: [
        rule({
          matchType: 'DESCRIPTION',
          matchKey: 'amzn mktp',
          name: 'Amazon',
        }),
      ],
      descriptions: ['AMZN MKTP 123'],
    });
    expect(out).toEqual([
      expect.objectContaining({
        matchType: 'DESCRIPTION',
        text: 'AMZN MKTP 123',
        name: 'Amazon',
        remove: false,
      }),
    ]);
  });

  it('the same name again (any case) is no conflict', () => {
    expect(
      findLinkConflicts({
        matchType: 'DESCRIPTION',
        key: 'amzn mktp',
        name: 'AMAZON',
        rules: [
          rule({
            matchType: 'DESCRIPTION',
            matchKey: 'amzn mktp',
            name: 'Amazon',
          }),
        ],
        descriptions: ['AMZN MKTP 123'],
      }),
    ).toEqual([]);
  });

  it('a description a text rule of another name reaches', () => {
    const out = findLinkConflicts({
      matchType: 'DESCRIPTION',
      key: 'amzn mktp',
      name: 'Staples',
      rules: [
        rule({
          id: 4,
          matchType: 'CONTAINS',
          matchKey: 'amzn',
          includeChars: 'AMZN',
          name: 'Amazon',
        }),
      ],
      descriptions: ['AMZN MKTP 123', 'WALMART'],
    });
    expect(out).toEqual([
      {
        matchType: 'CONTAINS',
        text: 'AMZN',
        name: 'Amazon',
        ruleId: 4,
        remove: false,
      },
    ]);
  });

  it('overlapping texts: a longer one must go, a shorter one loses by itself', () => {
    const out = findLinkConflicts({
      matchType: 'CONTAINS',
      key: 'amzn mk',
      name: 'Staples',
      rules: [
        rule({
          id: 1,
          matchType: 'CONTAINS',
          matchKey: 'amzn mktp',
          name: 'Amazon',
        }),
        rule({
          id: 2,
          matchType: 'CONTAINS',
          matchKey: 'amzn',
          name: 'Amazon',
        }),
        rule({
          id: 3,
          matchType: 'CONTAINS',
          matchKey: 'walmart',
          name: 'Walmart',
        }),
        rule({
          id: 5,
          matchType: 'CONTAINS',
          matchKey: 'amzn m',
          category: 'Office',
        }),
      ],
      descriptions: [],
    });
    expect(out.map((c) => [c.ruleId, c.remove])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('a text covering an exact description of another name', () => {
    const out = findLinkConflicts({
      matchType: 'CONTAINS',
      key: 'amzn',
      name: 'Staples',
      rules: [
        rule({
          id: 9,
          matchType: 'DESCRIPTION',
          matchKey: 'amzn mktp',
          name: 'Amazon',
        }),
      ],
      descriptions: ['AMZN MKTP 123', 'AMZN MKTP 456', 'TIM HORTONS'],
    });
    expect(out).toEqual([
      {
        matchType: 'DESCRIPTION',
        text: 'AMZN MKTP 123',
        name: 'Amazon',
        ruleId: 9,
        remove: true,
      },
    ]);
  });

  it('says which name has it', () => {
    expect(
      linkConflictMessage([{ text: 'AMZN MKTP', name: 'Amazon' }], 'Staples'),
    ).toBe(
      'Already linked to Amazon: "AMZN MKTP" → Amazon. Confirm to take it away from Amazon and link it to Staples, or change only this transaction instead.',
    );
  });
});

describe('NameMemoryService — RULE_CONFLICT', () => {
  it('refuses to move a description linked to another name, and writes nothing', async () => {
    const { prisma, rows, rules } = fakePrisma(
      [tx(1, 'AMZN MKTP 123', 'Amazon')],
      [
        {
          id: 1,
          matchType: 'DESCRIPTION',
          matchKey: 'amzn mktp',
          name: 'Amazon',
          category: null,
        },
      ],
    );
    const body = await conflictOf(
      service(prisma).saveRule(BOOK, {
        matchType: 'DESCRIPTION',
        matchKey: 'amzn mktp',
        name: 'Staples',
        category: null,
      }),
    );
    expect(body).toMatchObject({
      code: RULE_CONFLICT,
      conflicts: [
        { matchType: 'DESCRIPTION', text: 'AMZN MKTP 123', name: 'Amazon' },
      ],
    });
    expect(rules[0].name).toBe('Amazon');
    expect(rows[0].name).toBe('Amazon');
  });

  it('the same name again goes through', async () => {
    const { prisma, rules } = fakePrisma(
      [tx(1, 'AMZN MKTP 123', 'Amazon')],
      [
        {
          id: 1,
          matchType: 'DESCRIPTION',
          matchKey: 'amzn mktp',
          name: 'Amazon',
          category: null,
        },
      ],
    );
    await service(prisma).saveRule(BOOK, {
      matchType: 'DESCRIPTION',
      matchKey: 'amzn mktp',
      name: 'amazon',
      category: null,
    });
    expect(rules[0].name).toBe('amazon');
  });

  it('replace moves the description to the new name', async () => {
    const { prisma, rows, rules } = fakePrisma(
      [tx(1, 'AMZN MKTP 123', 'Amazon')],
      [
        {
          id: 1,
          matchType: 'DESCRIPTION',
          matchKey: 'amzn mktp',
          name: 'Amazon',
          category: null,
        },
      ],
    );
    await service(prisma).saveRule(BOOK, {
      matchType: 'DESCRIPTION',
      matchKey: 'amzn mktp',
      name: 'Staples',
      category: null,
      replace: true,
    });
    expect(rules[0].name).toBe('Staples');
    expect(rows[0].name).toBe('Staples');
  });

  it('an overlapping text: refused, then with replace the longer rule goes and every row moves', async () => {
    const make = () =>
      fakePrisma(
        [tx(1, 'AMZN MKTP 123', 'Amazon'), tx(2, 'AMZN WEB SERVICES', 'Aws')],
        [
          {
            id: 1,
            matchType: 'CONTAINS',
            matchKey: 'amzn mktp',
            includeChars: 'AMZN MKTP',
            name: 'Amazon',
            category: null,
          },
        ],
      );
    const first = make();
    const body = await conflictOf(
      service(first.prisma).saveRule(BOOK, {
        matchType: 'CONTAINS',
        matchKey: 'AMZN',
        name: 'Staples',
        category: null,
      }),
    );
    expect(body?.conflicts).toEqual([
      { matchType: 'CONTAINS', text: 'AMZN MKTP', name: 'Amazon' },
    ]);
    expect(first.rows.map((r) => r.name)).toEqual(['Amazon', 'Aws']);

    const second = make();
    await service(second.prisma).saveRule(BOOK, {
      matchType: 'CONTAINS',
      matchKey: 'AMZN',
      name: 'Staples',
      category: null,
      replace: true,
    });
    expect(second.rules.map((r) => [r.matchType, r.matchKey, r.name])).toEqual([
      ['CONTAINS', 'amzn', 'Staples'],
    ]);
    expect(second.rows.map((r) => r.name)).toEqual(['Staples', 'Staples']);
  });

  it('a text covering an exact description of another name: refused, then that exact rule goes', async () => {
    const { prisma, rows, rules } = fakePrisma(
      [tx(1, 'AMZN MKTP 123', 'Amazon'), tx(2, 'AMZN WEB', 'Aws')],
      [
        {
          id: 1,
          matchType: 'DESCRIPTION',
          matchKey: 'amzn mktp',
          name: 'Amazon',
          category: null,
        },
      ],
    );
    const body = await conflictOf(
      service(prisma).saveRule(BOOK, {
        matchType: 'CONTAINS',
        matchKey: 'amzn',
        name: 'Staples',
        category: null,
      }),
    );
    expect(body?.conflicts).toEqual([
      { matchType: 'DESCRIPTION', text: 'AMZN MKTP 123', name: 'Amazon' },
    ]);
    await service(prisma).saveRule(BOOK, {
      matchType: 'CONTAINS',
      matchKey: 'amzn',
      name: 'Staples',
      category: null,
      replace: true,
    });
    expect(rules.map((r) => r.matchType)).toEqual(['CONTAINS']);
    expect(rows.map((r) => r.name)).toEqual(['Staples', 'Staples']);
  });

  it('a ledger "Always" rename is refused BEFORE the clicked row changes', async () => {
    const row = { ...tx(5, 'AMZN MKTP 9', 'Amazon'), manualEdit: true };
    const { prisma, rows } = fakePrisma(
      [row],
      [
        {
          id: 1,
          matchType: 'CONTAINS',
          matchKey: 'amzn',
          includeChars: 'AMZN',
          name: 'Amazon',
          category: null,
        },
      ],
    );
    const body = await conflictOf(
      service(prisma).editTransaction(BOOK, 5, {
        name: 'Staples',
        category: null,
        scope: 'ALWAYS',
      }),
    );
    expect(body?.conflicts).toEqual([
      { matchType: 'CONTAINS', text: 'AMZN', name: 'Amazon' },
    ]);
    expect(rows[0].name).toBe('Amazon');
    expect(prisma.bankTransaction.update).not.toHaveBeenCalled();
  });

  it('"only this row" is never refused', async () => {
    const { prisma, rows } = fakePrisma(
      [tx(5, 'AMZN MKTP 9', 'Amazon')],
      [
        {
          id: 1,
          matchType: 'DESCRIPTION',
          matchKey: 'amzn mktp',
          name: 'Amazon',
          category: null,
        },
      ],
    );
    await service(prisma).editTransaction(BOOK, 5, {
      name: 'Staples',
      category: null,
      scope: 'ONCE',
    });
    expect(rows[0].name).toBe('Staples');
  });

  it('a race on the unique key is a 409, not a 500', async () => {
    const { prisma } = fakePrisma([], []);
    prisma.customerNameRule.create.mockImplementationOnce(() => {
      throw Object.assign(new Error('unique'), { code: 'P2002' });
    });
    const body = await conflictOf(
      service(prisma).saveRule(BOOK, {
        matchType: 'DESCRIPTION',
        matchKey: 'tim hortons',
        name: 'Tim Hortons',
        category: null,
      }),
    );
    expect(body).toMatchObject({ code: RULE_CONFLICT, conflicts: [] });
  });
});

describe('containsRows — a longer text keeps its rows (step2 fix)', () => {
  it('saving a shorter text leaves the rows a longer text wins', async () => {
    const { prisma, rows } = fakePrisma(
      [tx(1, 'AMZN MKTP 123', 'Amazon Marketplace'), tx(2, 'AMZN WEB', 'Aws')],
      // Category-only: no name to conflict with, but it still wins its rows.
      [
        {
          id: 1,
          matchType: 'CONTAINS',
          matchKey: 'amzn mktp',
          includeChars: 'AMZN MKTP',
          name: null,
          category: 'Office Supplies',
        },
      ],
    );
    await service(prisma).saveRule(BOOK, {
      matchType: 'CONTAINS',
      matchKey: 'amzn',
      name: 'Amazon',
      category: null,
    });
    expect(rows.map((r) => r.name)).toEqual(['Amazon Marketplace', 'Amazon']);
  });
});
