import { StripeBillingService } from './stripe-billing.service';

/** 2026-11-25: every live account gets ONE Stripe Customer — sweep and sign-up alike. */
describe('StripeBillingService — a Stripe Customer for every account', () => {
  function build(customers: Array<{ id: number; stripeCustomerId: string | null; deletedAt?: Date | null }>) {
    const rows = customers.map((c) => ({ email: null, name: '', phone: null, deletedAt: null, ...c }));
    const prisma = {
      customer: {
        findMany: jest.fn(({ where }) =>
          Promise.resolve(rows.filter((r) => r.stripeCustomerId === null && r.deletedAt === null)),
        ),
        findUnique: jest.fn(({ where }) => Promise.resolve(rows.find((r) => r.id === where.id) ?? null)),
        updateMany: jest.fn(({ where, data }) => {
          const r = rows.find((x) => x.id === where.id && x.stripeCustomerId === null);
          if (r) r.stripeCustomerId = data.stripeCustomerId;
          return Promise.resolve({ count: r ? 1 : 0 });
        }),
      },
    };
    const create = jest.fn((params: { metadata: { customerId: string } }) =>
      Promise.resolve({ id: `cus_${params.metadata.customerId}` }),
    );
    const stripeClient = { configured: true, stripe: { customers: { create } } };
    const service = new StripeBillingService(
      prisma as never,
      {} as never,
      stripeClient as never,
      {} as never,
    );
    return { service, rows, create, prisma };
  }

  it('makes one for each live account that has none, with an idempotency key', async () => {
    const { service, rows, create } = build([
      { id: 1, stripeCustomerId: 'cus_old' },
      { id: 2, stripeCustomerId: null },
      { id: 3, stripeCustomerId: null, deletedAt: new Date() },
      { id: 4, stripeCustomerId: null },
    ]);
    expect(await service.ensureAllStripeCustomers()).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][1]).toEqual({ idempotencyKey: 'cyg-customer-2' });
    expect(rows.map((r) => r.stripeCustomerId)).toEqual(['cus_old', 'cus_2', null, 'cus_4']);
    // A second run makes none.
    expect(await service.ensureAllStripeCustomers()).toBe(0);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('a Stripe failure is logged and the rest still get theirs', async () => {
    const { service, rows, create } = build([
      { id: 5, stripeCustomerId: null },
      { id: 6, stripeCustomerId: null },
    ]);
    create.mockImplementationOnce(() => Promise.reject(new Error('rate limited')));
    expect(await service.ensureAllStripeCustomers()).toBe(1);
    expect(rows.map((r) => r.stripeCustomerId)).toEqual([null, 'cus_6']);
  });
});
