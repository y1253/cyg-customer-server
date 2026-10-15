import { normalizeEmail, planBackfill } from './company-backfill.util';

const co = (
  id: number,
  privateEmail: string | null,
  personalName: string | null = null,
) => ({ id, businessName: `Biz ${id}`, privateEmail, personalName });

describe('planBackfill', () => {
  it('gives companies that share an owner email ONE account', () => {
    const plan = planBackfill(
      [co(1, 'Dana@X.ca', 'Dana'), co(2, ' dana@x.ca '), co(3, 'sam@y.ca')],
      new Map(),
    );
    expect(plan.create).toEqual([
      { email: 'dana@x.ca', name: 'Dana', companyIds: [1, 2] },
      { email: 'sam@y.ca', name: 'Biz 3', companyIds: [3] },
    ]);
  });

  it('links to an account that already exists instead of creating one', () => {
    const plan = planBackfill(
      [co(1, 'dana@x.ca'), co(2, 'DANA@x.ca')],
      new Map([['dana@x.ca', 42]]),
    );
    expect(plan.create).toEqual([]);
    expect(plan.link).toEqual([
      { customerId: 42, email: 'dana@x.ca', companyIds: [1, 2] },
    ]);
  });

  it('skips a company with no usable email, and says why', () => {
    const plan = planBackfill([co(1, null), co(2, '  '), co(3, 'n/a')], new Map());
    expect(plan.create).toEqual([]);
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      'no owner email',
      'no owner email',
      'not an email: "n/a"',
    ]);
  });
});

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  A@B.Co ')).toBe('a@b.co');
  });
});
