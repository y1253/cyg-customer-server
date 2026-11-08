import { BadRequestException, ConflictException } from '@nestjs/common';
import { CustomerAccountsService } from './customer-accounts.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { BookScope } from './scope';

const scope: BookScope = { customerId: 7, bookId: 3, companyId: null };
const where = { customerId: 7, bookId: 3, companyId: null };

type Write = { op: string; args: { where?: unknown; data?: unknown } };

/**
 * A Prisma double: every write returns a `Write` record (what `$transaction` receives), and
 * the reads answer from `state` — which account names exist where.
 */
function fakePrisma(state: {
  rows?: string[];
  statements?: string[];
  plaid?: string[];
  own?: Array<{ id: number; name: string; replaces?: string | null }>;
  agencies?: string[];
}) {
  const writes: Write[] = [];
  const write = (op: string) =>
    jest.fn((args: Write['args']) => ({ op, args }) as Write);
  const lower = (s: unknown) => String(s).toLowerCase();
  const has = (list: string[] | undefined, name: unknown) =>
    (list ?? []).some((n) => lower(n) === lower(name));
  type Where = Record<string, unknown> & {
    OR?: Array<Record<string, string>>;
  };
  const rowName = (w: Where) =>
    w.OR ? Object.values(w.OR[0])[0] : (w.offsetAccount as string);
  const prisma = {
    taxAgency: {
      findFirst: jest.fn(({ where: w }: { where: Where }) =>
        has(state.agencies, w.name) ? { id: 1 } : null,
      ),
    },
    bankStatement: {
      findFirst: jest.fn(({ where: w }: { where: Where }) =>
        has(state.statements, w.accountName)
          ? { id: 1, accountKind: 'BANK', currency: null }
          : null,
      ),
      count: jest.fn(({ where: w }: { where: Where }) =>
        has(state.statements, w.accountName) ? 1 : 0,
      ),
      updateMany: write('bankStatement.updateMany'),
    },
    plaidAccount: {
      findFirst: jest.fn(({ where: w }: { where: Where }) =>
        has(state.plaid, w.accountName)
          ? { id: 1, kind: 'BANK', currency: null }
          : null,
      ),
      count: jest.fn(({ where: w }: { where: Where }) =>
        has(state.plaid, w.accountName) ? 1 : 0,
      ),
      updateMany: write('plaidAccount.updateMany'),
    },
    bankTransaction: {
      count: jest.fn(({ where: w }: { where: Where }) =>
        has(state.rows, rowName(w)) ? 5 : 0,
      ),
      findFirst: jest.fn(({ where: w }: { where: Where }) =>
        has(state.rows, rowName(w)) ? { id: 1 } : null,
      ),
      updateMany: write('bankTransaction.updateMany'),
    },
    customerAccount: {
      findFirst: jest.fn(
        ({ where: w }: { where: Where }) =>
          (state.own ?? []).find((a) => lower(a.name) === lower(w.name)) ??
          null,
      ),
      update: write('customerAccount.update'),
      create: write('customerAccount.create'),
      delete: write('customerAccount.delete'),
      deleteMany: write('customerAccount.deleteMany'),
    },
    customerAccountCurrency: {
      findFirst: jest.fn(() => null),
      updateMany: write('customerAccountCurrency.updateMany'),
      deleteMany: write('customerAccountCurrency.deleteMany'),
    },
    customerAccountType: {
      updateMany: write('customerAccountType.updateMany'),
      deleteMany: write('customerAccountType.deleteMany'),
    },
    customerNameRule: { updateMany: write('customerNameRule.updateMany') },
    customerItemRule: { updateMany: write('customerItemRule.updateMany') },
    $transaction: jest.fn((list: Write[]) => {
      writes.push(...list);
      return Promise.resolve(list);
    }),
  };
  return { prisma: prisma as unknown as PrismaService, writes };
}

const ops = (writes: Write[]) => writes.map((w) => w.op);
const dataOf = (writes: Write[], op: string) =>
  writes.filter((w) => w.op === op).map((w) => w.args.data);

describe('CustomerAccountsService.renameAccount (step2)', () => {
  it('renames a bank folder everywhere and keeps its settings', async () => {
    const { prisma, writes } = fakePrisma({
      rows: ['TD 4562'],
      statements: ['TD 4562'],
      plaid: ['TD 4562'],
    });
    await new CustomerAccountsService(prisma).renameAccount(
      scope,
      'TD 4562',
      'TD Chequing 4562',
    );
    expect(dataOf(writes, 'bankStatement.updateMany')).toEqual([
      { accountName: 'TD Chequing 4562' },
      { accountNameByCustomer: 'TD Chequing 4562' },
    ]);
    expect(dataOf(writes, 'plaidAccount.updateMany')).toEqual([
      { accountName: 'TD Chequing 4562' },
    ]);
    expect(dataOf(writes, 'bankTransaction.updateMany')).toEqual([
      { offsetAccount: 'TD Chequing 4562' },
      { debitAccount: 'TD Chequing 4562' },
      { creditAccount: 'TD Chequing 4562' },
    ]);
    // Section and currency are renamed, never deleted.
    expect(dataOf(writes, 'customerAccountType.updateMany')).toEqual([
      { account: 'TD Chequing 4562' },
    ]);
    expect(dataOf(writes, 'customerAccountCurrency.updateMany')).toEqual([
      { account: 'TD Chequing 4562' },
    ]);
    expect(ops(writes)).not.toContain('customerAccountType.deleteMany');
    expect(ops(writes)).not.toContain('customerAccount.create');
    expect(writes[0].args.where).toMatchObject(where);
  });

  it("renames the customer's own category row", async () => {
    const { prisma, writes } = fakePrisma({
      rows: ['Team lunches'],
      own: [{ id: 9, name: 'Team lunches' }],
    });
    await new CustomerAccountsService(prisma).renameAccount(
      scope,
      'Team lunches',
      'Staff meals',
    );
    expect(writes.find((w) => w.op === 'customerAccount.update')?.args).toEqual(
      { where: { id: 9 }, data: { name: 'Staff meals' } },
    );
  });

  it('turns a chart account into their own one that replaces it', async () => {
    const { prisma, writes } = fakePrisma({ rows: ['Travel'] });
    await new CustomerAccountsService(prisma).renameAccount(
      scope,
      'Travel',
      'Trips',
    );
    expect(dataOf(writes, 'customerAccount.create')).toEqual([
      { ...where, name: 'Trips', type: 'EXPENSE', replaces: 'Travel' },
    ]);
  });

  it('goes back to the chart account it was renamed from', async () => {
    const { prisma, writes } = fakePrisma({
      rows: ['Trips'],
      own: [{ id: 4, name: 'Trips', replaces: 'Travel' }],
    });
    await new CustomerAccountsService(prisma).renameAccount(
      scope,
      'Trips',
      'Travel',
    );
    expect(writes.find((w) => w.op === 'customerAccount.delete')?.args).toEqual(
      { where: { id: 4 } },
    );
    expect(dataOf(writes, 'bankTransaction.updateMany')[0]).toEqual({
      offsetAccount: 'Travel',
    });
  });

  it('refuses a name already in use with 409 (merge instead)', async () => {
    const { prisma, writes } = fakePrisma({
      rows: ['TD 4562'],
      statements: ['TD 4562', 'BMO 5352'],
    });
    const service = new CustomerAccountsService(prisma);
    await expect(
      service.renameAccount(scope, 'TD 4562', 'bmo 5352'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.renameAccount(scope, 'TD 4562', 'Travel'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(writes).toEqual([]);
  });

  it('refuses tax agencies and unknown accounts', async () => {
    const { prisma } = fakePrisma({ agencies: ['GST'], rows: ['GST'] });
    const service = new CustomerAccountsService(prisma);
    await expect(
      service.renameAccount(scope, 'GST', 'GST/HST'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.renameAccount(scope, 'Nothing here', 'Something'),
    ).rejects.toThrow(/not one of your accounts/);
  });
});

describe('CustomerAccountsService.mergeAccounts with a name (step2)', () => {
  it('merges two folders, then names the result', async () => {
    const { prisma, writes } = fakePrisma({
      rows: ['TD 4562', 'TD 5845'],
      statements: ['TD 4562', 'TD 5845'],
    });
    await new CustomerAccountsService(prisma).mergeAccounts(
      scope,
      'TD 5845',
      'TD 4562',
      'TD 4562 & 5845',
    );
    expect(dataOf(writes, 'bankStatement.updateMany')).toEqual([
      { accountName: 'TD 4562' },
      { accountNameByCustomer: 'TD 4562' },
      { accountName: 'TD 4562 & 5845' },
      { accountNameByCustomer: 'TD 4562 & 5845' },
    ]);
    // `from`'s settings go, `into`'s are renamed after.
    const order = ops(writes);
    expect(order.indexOf('customerAccountType.deleteMany')).toBeLessThan(
      order.indexOf('customerAccountType.updateMany'),
    );
  });

  it('may take the merged-away name', async () => {
    const { prisma, writes } = fakePrisma({
      rows: ['TD 4562', 'TD 5845'],
      statements: ['TD 4562', 'TD 5845'],
    });
    await new CustomerAccountsService(prisma).mergeAccounts(
      scope,
      'TD 5845',
      'TD 4562',
      'TD 5845',
    );
    expect(dataOf(writes, 'bankStatement.updateMany').at(-2)).toEqual({
      accountName: 'TD 5845',
    });
  });

  it('refuses a name another account has', async () => {
    const { prisma, writes } = fakePrisma({
      rows: ['TD 4562', 'TD 5845'],
      statements: ['TD 4562', 'TD 5845', 'BMO 5352'],
    });
    await expect(
      new CustomerAccountsService(prisma).mergeAccounts(
        scope,
        'TD 5845',
        'TD 4562',
        'BMO 5352',
      ),
    ).rejects.toThrow(/already have an account/);
    expect(writes).toEqual([]);
  });
});
