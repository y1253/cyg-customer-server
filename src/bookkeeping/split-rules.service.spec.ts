import type { PrismaService } from '../prisma/prisma.service';
import type { CustomerAccountsService } from './customer-accounts.service';
import { SplitRulesService } from './split-rules.service';

const scope = { customerId: 7, bookId: 3, companyId: null };

interface Row {
  id: number;
  name: string | null;
  amount: number;
  offsetAccount: string;
  splitOfId: number | null;
  subNameId: number | null;
  splitRuleId: number | null;
  ruleSourceId: number | null;
}

/**
 * One Staples purchase of $105 (Office Expense) with $42 split off by hand into the sub-name
 * "Staples - Supplies" (id 9). Rule 5 "GST": Out 5%; rule 6 "Fee": Out $2.00 fixed, category
 * Bank Fees. Creates / updates land in `rows`, so `apply` can be called twice.
 */
function setup(opts: {
  picks: Array<{ name: string; agencyId: number; lineName?: string | null }>;
  ownSub?: boolean;
  /** step9 (2026-11-17, second request): the transaction is "Staples - Office Expense" (10). */
  rootSub?: boolean;
  named?: Array<{ transactionId: number; agencyId: number; name: string }>;
}) {
  const rows: Row[] = [
    {
      id: 1,
      name: 'Staples',
      amount: -105,
      offsetAccount: 'Office Expense',
      splitOfId: null,
      subNameId: opts.rootSub ? 10 : null,
      splitRuleId: null,
      ruleSourceId: null,
    },
    {
      id: 2,
      name: 'Staples',
      amount: -42,
      offsetAccount: 'Supplies',
      splitOfId: 1,
      subNameId: 9,
      splitRuleId: null,
      ruleSourceId: null,
    },
  ];
  let nextId = 100;
  const subs = [
    { id: 9, name: 'Staples - Supplies', category: 'Supplies' },
    ...(opts.rootSub
      ? [
          {
            id: 10,
            name: 'Staples - Office Expense',
            category: 'Office Expense',
          },
        ]
      : []),
  ];
  const parentRows = () =>
    rows
      .filter((r) => r.splitOfId === null)
      .map((p) => ({
        ...p,
        statementId: 1,
        position: 0,
        pendingDate: null,
        postingDate: null,
        description: 'STAPLES #12',
        debitAccount: 'Office Expense',
        creditAccount: 'Chase 4362',
        splits: rows.filter((s) => s.splitOfId === p.id),
      }));
  const prisma = {
    taxAgency: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 5,
          name: 'GST',
          category: null,
          rates: [{ kind: 'PURCHASE', mode: 'PERCENT', rate: 5, amount: null }],
        },
        {
          id: 6,
          name: 'Fee',
          category: 'Bank Fees',
          rates: [{ kind: 'PURCHASE', mode: 'FIXED', rate: 0, amount: 2 }],
        },
      ]),
    },
    ledgerNameAgency: {
      findMany: jest
        .fn()
        .mockResolvedValue(opts.picks.map((p) => ({ lineName: null, ...p }))),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    subName: {
      findMany: jest.fn(({ where }: { where: { ownAgencies?: boolean } }) =>
        Promise.resolve(
          where.ownAgencies && !opts.ownSub ? [] : subs.map((s) => ({ ...s })),
        ),
      ),
      findFirst: jest.fn(({ where }: { where: { category: string } }) =>
        Promise.resolve(
          subs.find((s) => s.category === where.category) ?? null,
        ),
      ),
      create: jest.fn(
        ({ data }: { data: { name: string; category: string } }) => {
          const s = { id: nextId++, name: data.name, category: data.category };
          subs.push(s);
          return Promise.resolve(s);
        },
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ledgerName: {
      findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      // No wrapper names: `fileUnderSubNames` has nothing to file.
      findMany: jest.fn().mockResolvedValue([]),
    },
    transactionTax: {
      findMany: jest.fn().mockResolvedValue(opts.named ?? []),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    bankTransaction: {
      // `parentsFor` / `convertBook` ask for parents with their splits; the sub-name sync
      // (`syncParentSubNames`) asks with a `select` and gets nothing to do.
      findMany: jest.fn((args: { include?: unknown }) =>
        Promise.resolve(args.include ? parentRows() : []),
      ),
      groupBy: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const r: Row = {
          id: nextId++,
          name: data.name as string,
          amount: Number(data.amount),
          offsetAccount: data.offsetAccount as string,
          splitOfId: data.splitOfId as number,
          subNameId: (data.subNameId as number | null) ?? null,
          splitRuleId: data.splitRuleId as number,
          ruleSourceId: data.ruleSourceId as number,
        };
        rows.push(r);
        return Promise.resolve(r);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: { amount: string };
        }) => {
          const r = rows.find((x) => x.id === where.id)!;
          r.amount = Number(data.amount);
          return Promise.resolve(r);
        },
      ),
    },
    $transaction: jest.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  const accounts = {
    types: jest.fn().mockResolvedValue(new Map()),
    overrides: jest.fn().mockResolvedValue(new Map()),
  };
  const service = new SplitRulesService(
    prisma as unknown as PrismaService,
    accounts as unknown as CustomerAccountsService,
  );
  const made = () => rows.filter((r) => r.splitRuleId !== null);
  return { service, rows, made, prisma };
}

const applied = (p: { name: string; agencyId: number }) => ({
  ...p,
  appliedAt: new Date(),
});

describe('SplitRulesService.apply', () => {
  it("splits what is left of the transaction by the name's rules, once — never the customer's split", async () => {
    const { service, rows, made } = setup({
      picks: [applied({ name: 'STAPLES', agencyId: 5 })],
    });
    expect(await service.apply(scope, { names: ['Staples'] })).toBe(1);
    // 5% included in the $63 left (63 × 5 / 105 = 3). step9 (2026-11-17): the $42 split the
    // customer made shares the name but is not cut — the line holding the description is.
    expect(
      made().map((r) => [r.ruleSourceId, r.amount, r.offsetAccount]),
    ).toEqual([[1, -3, 'GST']]);
    expect(rows.find((r) => r.id === 2)!.amount).toBe(-42);
    // A second run finds the line already split by that rule.
    expect(await service.apply(scope, { names: ['Staples'] })).toBe(0);
  });

  it('a fixed rule takes its amount first, into its own category', async () => {
    const { service, made } = setup({
      picks: [
        applied({ name: 'Staples', agencyId: 5 }),
        applied({ name: 'Staples', agencyId: 6 }),
      ],
    });
    await service.apply(scope, { transactionIds: [1], ruleIds: [6] });
    expect(
      made().map((r) => [r.ruleSourceId, r.amount, r.offsetAccount]),
    ).toEqual([[1, -2, 'Bank Fees']]);
  });

  it("step9 (2026-11-17, second request): only the transaction is cut — by its own sub-name's rules — never a split", async () => {
    const { service, made, rows } = setup({
      picks: [
        applied({ name: 'Staples', agencyId: 5 }),
        applied({ name: 'staples - office expense', agencyId: 6 }),
        // The split's own sub-name has a rule too: the system never splits a split.
        applied({ name: 'staples - supplies', agencyId: 5 }),
      ],
      ownSub: true,
      rootSub: true,
    });
    await service.apply(scope, { transactionIds: [1] });
    expect(made().map((r) => [r.ruleSourceId, r.splitRuleId])).toEqual([
      [1, 6],
    ]);
    expect(rows.find((r) => r.id === 2)!.amount).toBe(-42);
  });
});

describe('SplitRulesService.convertBook (the on-read tax lines become splits)', () => {
  it('writes the amounts the ledger showed, with the line names the customer gave', async () => {
    const { service, made, prisma } = setup({
      picks: [{ name: 'STAPLES', agencyId: 5 }],
      named: [{ transactionId: 1, agencyId: 5, name: 'GST paid' }],
    });
    // step9 (2026-11-17, second request): the transaction only, never its splits.
    expect(await service.convertBook(scope)).toBe(1);
    expect(made().map((r) => [r.ruleSourceId, r.amount, r.name])).toEqual([
      [1, -3, 'GST paid'],
    ]);
    // Marked done: the picks are applied, the old line names gone.
    expect(prisma.ledgerNameAgency.updateMany).toHaveBeenCalled();
    expect(prisma.transactionTax.deleteMany).toHaveBeenCalled();
  });
});
