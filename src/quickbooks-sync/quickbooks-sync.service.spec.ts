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
