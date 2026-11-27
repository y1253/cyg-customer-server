import { QboCallError } from './qbo-system.client';
import { QuickBooksSyncService } from './quickbooks-sync.service';

/** step11 part 2 (2026-11-26): a name merge reaches QuickBooks (`mergePayee`). */
describe('QuickBooksSyncService.mergePayee', () => {
  const scope = { customerId: 1, bookId: 2, companyId: 3 };

  function setup(opts: {
    on?: boolean;
    entities: Record<string, { Id: string; type: string }>;
    purchases?: Array<Record<string, unknown>>;
  }) {
    const prisma = {
      quickBooksAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            opts.on === false
              ? { updateQuickbooks: null, lastError: null }
              : { updateQuickbooks: new Date(), lastError: null },
          ),
      },
    };
    const update = jest.fn().mockResolvedValue({});
    const query = jest.fn((_company: number, q: string) => {
      const m = /from (\w+) where DisplayName = '(.*)' MAXRESULTS 1/.exec(q);
      if (m) {
        const hit = opts.entities[m[2]];
        return Promise.resolve(
          hit && hit.type === m[1] ? { [m[1]]: [{ Id: hit.Id }] } : {},
        );
      }
      if (q.startsWith('select * from Purchase'))
        return Promise.resolve({ Purchase: opts.purchases ?? [] });
      return Promise.resolve({});
    });
    const service = new QuickBooksSyncService(
      prisma as never,
      { query, update } as never,
      {} as never,
    );
    const syncSoon = jest
      .spyOn(service, 'syncSoon')
      .mockImplementation(() => undefined);
    return { service, update, syncSoon };
  }

  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('renames the old payee when QuickBooks has no target', async () => {
    const { service, update, syncSoon } = setup({
      entities: { Wallmart: { Id: '5', type: 'Vendor' } },
    });
    service.mergePayee(scope, 'Wallmart', 'Walmart');
    await settle();
    await settle();
    expect(update).toHaveBeenCalledWith(3, 'Vendor', '5', {
      DisplayName: 'Walmart',
    });
    expect(syncSoon).toHaveBeenCalledWith(2);
  });

  it('moves the old payee’s transactions onto the target and makes it inactive', async () => {
    const { service, update } = setup({
      entities: {
        Wallmart: { Id: '5', type: 'Vendor' },
        Walmart: { Id: '9', type: 'Vendor' },
      },
      purchases: [
        { Id: '100', SyncToken: '1', EntityRef: { value: '5' } },
        { Id: '101', SyncToken: '1', EntityRef: { value: '8' } },
      ],
    });
    service.mergePayee(scope, 'Wallmart', 'Walmart');
    for (let i = 0; i < 6; i++) await settle();
    expect(update).toHaveBeenCalledWith(3, 'Purchase', '100', {
      SyncToken: '1',
      EntityRef: { value: '9', type: 'Vendor' },
    });
    expect(update).not.toHaveBeenCalledWith(
      3,
      'Purchase',
      '101',
      expect.anything(),
    );
    expect(update).toHaveBeenCalledWith(3, 'Vendor', '5', { Active: false });
  });

  it('does nothing in QuickBooks while the push is off', async () => {
    const { service, update, syncSoon } = setup({
      on: false,
      entities: { Wallmart: { Id: '5', type: 'Vendor' } },
    });
    service.mergePayee(scope, 'Wallmart', 'Walmart');
    await settle();
    await settle();
    expect(update).not.toHaveBeenCalled();
    expect(syncSoon).toHaveBeenCalledWith(2);
  });
});

/** step11 part 3 (2026-11-26): custom fields / classes refused, and the existing bank account. */
describe('QuickBooksSyncService — step11 part 3', () => {
  const scope = { customerId: 1, bookId: 2, companyId: 3 };

  it('sends the transaction again without the custom fields QuickBooks refused', async () => {
    const update = jest
      .fn()
      .mockRejectedValueOnce(
        new QboCallError(400, 'Invalid CustomField DefinitionId'),
      )
      .mockResolvedValue({});
    const query = jest.fn().mockResolvedValue({ Account: [{ Id: '50' }] });
    const rowUpdate = jest.fn().mockResolvedValue({});
    const service = new QuickBooksSyncService(
      { bankTransaction: { update: rowUpdate } } as never,
      { query, update } as never,
      {} as never,
    );
    const row = {
      id: 10,
      qboId: '77',
      qboType: 'Purchase',
      statement: {
        plaidAccount: {
          id: 11,
          kind: 'BANK',
          accountName: 'TD 4562',
          qboAccountId: '35',
        },
      },
    };
    const family = {
      rowId: 10,
      externalId: 'p1',
      date: '2026-11-20',
      cents: -1000,
      name: null,
      description: 'X',
      kind: 'BANK',
      plaidAccountId: 11,
      lines: [{ category: 'Office Expense', cents: 1000, description: null }],
      fields: [{ ref: '1', value: 'Job 42' }],
    };
    const cache = {
      accounts: new Map(),
      entities: new Map(),
      types: {},
      classes: new Map(),
    };
    await (
      service as never as { push: (...a: unknown[]) => Promise<void> }
    ).push(3, scope, row, family, 'h', cache);
    expect(update).toHaveBeenCalledTimes(2);
    const bodies = update.mock.calls.map((c) => (c as unknown[])[3]);
    expect(bodies[0]).toHaveProperty('CustomField');
    expect(bodies[1]).not.toHaveProperty('CustomField');
    const saved = (rowUpdate.mock.calls[0] as [{ data: unknown }])[0].data;
    expect(saved).toMatchObject({ qboId: '77', qboError: null });
  });

  it('finds the QuickBooks bank account by name and proves it by the transactions', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const prisma = {
      plaidAccount: {
        findUnique: jest.fn().mockResolvedValue({
          accountName: 'TD 4562',
          mask: '4562',
          kind: 'BANK',
          item: { institutionName: 'TD Canada Trust' },
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      bankTransaction: {
        findMany: jest.fn().mockResolvedValue(
          [-1000, -2500, 4000, -700].map((n) => ({
            amount: n / 100,
            postingDate: new Date(`${today}T00:00:00Z`),
            pendingDate: null,
          })),
        ),
      },
    };
    const query = jest.fn((_c: number, q: string) => {
      if (q.includes("AccountType = 'Bank'"))
        return Promise.resolve({
          Account: [
            { Id: '35', Name: 'TD Chequing', AcctNum: '1234562' },
            { Id: '36', Name: 'TD Savings', AcctNum: null },
          ],
        });
      if (q.includes('from Purchase'))
        return Promise.resolve({
          Purchase: [
            { TxnDate: today, TotalAmt: 10, AccountRef: { value: '35' } },
            { TxnDate: today, TotalAmt: 25, AccountRef: { value: '35' } },
            { TxnDate: today, TotalAmt: 7, AccountRef: { value: '36' } },
          ],
        });
      if (q.includes('from Deposit'))
        return Promise.resolve({
          Deposit: [
            {
              TxnDate: today,
              TotalAmt: 40,
              DepositToAccountRef: { value: '35' },
            },
          ],
        });
      return Promise.resolve({});
    });
    const service = new QuickBooksSyncService(
      prisma as never,
      { query } as never,
      {} as never,
    );
    const cache = {
      accounts: new Map(),
      entities: new Map(),
      types: {},
      classes: new Map(),
    };
    const id = await (
      service as never as {
        matchBankAccount: (...a: unknown[]) => Promise<string | null>;
      }
    ).matchBankAccount(3, scope, 11, cache);
    expect(id).toBe('35');
  });
});
