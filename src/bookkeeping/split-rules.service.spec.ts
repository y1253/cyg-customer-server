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
  /** step12: a second Staples purchase (#3, $210, no splits). */
  second?: boolean;
  /** step12: GST (5) and QST (7, Out 9.975%) form the split group 4 "Quebec taxes". */
  group?: boolean;
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
    ...(opts.second
      ? [
          {
            id: 3,
            name: 'Staples',
            amount: -210,
            offsetAccount: 'Office Expense',
            splitOfId: null,
            subNameId: null,
            splitRuleId: null,
            ruleSourceId: null,
          },
        ]
      : []),
  ];
  let nextId = 100;
  const subs = [
    { id: 9, name: 'Staples - Supplies', category: 'Supplies', splitKey: '' },
    ...(opts.rootSub
      ? [
          {
            id: 10,
            name: 'Staples - Office Expense',
            category: 'Office Expense',
            splitKey: '',
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
          groupId: opts.group ? 4 : null,
          rates: [{ kind: 'PURCHASE', mode: 'PERCENT', rate: 5, amount: null }],
        },
        {
          id: 6,
          name: 'Fee',
          category: 'Bank Fees',
          groupId: null,
          rates: [{ kind: 'PURCHASE', mode: 'FIXED', rate: 0, amount: 2 }],
        },
        ...(opts.group
          ? [
              {
                id: 7,
                name: 'QST',
                category: null,
                groupId: 4,
                rates: [
                  {
                    kind: 'PURCHASE',
                    mode: 'PERCENT',
                    rate: 9.975,
                    amount: null,
                  },
                ],
              },
            ]
          : []),
      ]),
      findFirst: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(
          where.id === 5
            ? { id: 5, name: 'GST' }
            : where.id === 6
              ? { id: 6, name: 'Fee' }
              : null,
        ),
      ),
    },
    splitGroup: {
      findFirst: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(
          opts.group && where.id === 4
            ? { id: 4, name: 'Quebec taxes', active: true }
            : null,
        ),
      ),
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
      findFirst: jest.fn(
        ({ where }: { where: { category: string; splitKey?: string } }) =>
          Promise.resolve(
            subs.find(
              (s) =>
                s.category === where.category &&
                s.splitKey === (where.splitKey ?? ''),
            ) ?? null,
          ),
      ),
      create: jest.fn(
        ({
          data,
        }: {
          data: { name: string; category: string; splitKey?: string };
        }) => {
          const s = {
            id: nextId++,
            name: data.name,
            category: data.category,
            splitKey: data.splitKey ?? '',
          };
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
      findMany: jest.fn(
        (args: { include?: unknown; where?: { id?: { in: number[] } } }) =>
          Promise.resolve(
            args.include
              ? parentRows().filter(
                  (p) => !args.where?.id || args.where.id.in.includes(p.id),
                )
              : [],
          ),
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
  const subName = (id: number | null) => subs.find((x) => x.id === id)?.name;
  return { service, rows, made, prisma, subName };
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

describe('SplitRulesService.applyOnce (step12: a one-time split from the ledger)', () => {
  it('cuts only this row, with no pick, under its own sub-name', async () => {
    const { service, made, subName, prisma } = setup({
      picks: [],
      second: true,
    });
    expect(
      await service.applyOnce(scope, { agencyId: 5 }, { transactionId: 1 }),
    ).toEqual({ split: 1, skipped: 0 });
    // GST has no category: it posts to "GST", so the label (= the category) is left out.
    expect(
      made().map((r) => [r.ruleSourceId, r.amount, subName(r.subNameId)]),
    ).toEqual([[1, -3, 'Staples - GST']]);
    // No pick is read or written: later rows are not cut.
    expect(prisma.ledgerNameAgency.findMany).not.toHaveBeenCalled();
    // A second click finds it already cut.
    expect(
      await service.applyOnce(scope, { agencyId: 5 }, { transactionId: 1 }),
    ).toEqual({ split: 0, skipped: 1 });
  });

  it("a group's pieces share one denominator, and the next row reuses the same sub-names", async () => {
    const { service, made, subName, prisma } = setup({
      picks: [],
      second: true,
      group: true,
    });
    await service.applyOnce(scope, { groupId: 4 }, { transactionId: 1 });
    await service.applyOnce(scope, { groupId: 4 }, { transactionId: 3 });
    expect(
      made().map((r) => [r.ruleSourceId, subName(r.subNameId)]),
    ).toEqual([
      [1, 'Staples - GST - Quebec taxes'],
      [1, 'Staples - QST - Quebec taxes'],
      [3, 'Staples - GST - Quebec taxes'],
      [3, 'Staples - QST - Quebec taxes'],
    ]);
    // One included denominator: 63 × 5 / 114.975 = 2.74 (QST absorbs the rounding).
    expect(made()[0].amount).toBe(-2.74);
    // Two sub-names made, once each — the second row reused them.
    expect(prisma.subName.create).toHaveBeenCalledTimes(2);
  });

  it('all rows of the name: every existing row once', async () => {
    const { service, made } = setup({ picks: [], second: true });
    expect(
      await service.applyOnce(scope, { agencyId: 6 }, { name: 'Staples' }),
    ).toEqual({ split: 2, skipped: 0 });
    expect(made().map((r) => [r.ruleSourceId, r.amount])).toEqual([
      [1, -2],
      [3, -2],
    ]);
    expect(
      await service.applyOnce(scope, { agencyId: 6 }, { name: 'Staples' }),
    ).toEqual({ split: 0, skipped: 2 });
  });

  it('refuses a split, an unknown rule and an unknown group', async () => {
    const { service } = setup({ picks: [] });
    await expect(
      service.applyOnce(scope, { agencyId: 5 }, { transactionId: 2 }),
    ).rejects.toThrow('not a split');
    await expect(
      service.applyOnce(scope, { agencyId: 99 }, { transactionId: 1 }),
    ).rejects.toThrow('Split rule not found');
    await expect(
      service.applyOnce(scope, { groupId: 4 }, { transactionId: 1 }),
    ).rejects.toThrow('Split group not found');
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
