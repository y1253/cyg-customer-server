import {
  accessOf,
  freeUntilAfter,
  monthlyUsage,
  monthOf,
  nextMonthStart,
  statusFromStripe,
  trialUsedUp,
  type SubscriptionLike,
  type TrialAllowance,
} from './entitlement.util';

const now = new Date('2026-11-25T15:00:00Z');
const sub = (over: Partial<SubscriptionLike> = {}): SubscriptionLike => ({
  status: 'NONE',
  everPaid: false,
  freeForever: false,
  freeUntil: null,
  ...over,
});
const allowance: TrialAllowance = { transactions: 100, texts: 15, callMinutes: 20 };
const used = (over: Partial<TrialAllowance> = {}): TrialAllowance => ({
  transactions: 0,
  texts: 0,
  callMinutes: 0,
  ...over,
});

describe('accessOf', () => {
  it('a paid plan is open; PAST_DUE too (the grace period while Stripe retries)', () => {
    expect(accessOf(sub({ status: 'ACTIVE', everPaid: true }), null, now)).toEqual({
      active: true,
      reason: 'PAID',
      limited: 'MONTHLY',
    });
    expect(
      accessOf(sub({ status: 'PAST_DUE', everPaid: true }), null, now).reason,
    ).toBe('PAST_DUE');
  });

  it('UNPAID / CANCELED lock the app', () => {
    expect(accessOf(sub({ status: 'UNPAID', everPaid: true }), null, now)).toMatchObject({
      active: false,
      reason: 'UNPAID',
    });
    expect(accessOf(sub({ status: 'CANCELED', everPaid: true }), null, now)).toMatchObject({
      active: false,
      reason: 'ENDED',
    });
  });

  it('a free promo opens it, until its end; forever never ends', () => {
    expect(
      accessOf(sub({ freeUntil: new Date('2026-12-01T00:00:00Z') }), null, now).reason,
    ).toBe('FREE');
    expect(accessOf(sub({ freeForever: true }), null, now).reason).toBe('FREE');
    // Ended promo, never paid, no trial left → the trial decides.
    expect(
      accessOf(
        sub({ freeUntil: new Date('2026-11-01T00:00:00Z') }),
        { allowance, used: used({ texts: 15 }) },
        now,
      ),
    ).toMatchObject({ active: false, reason: 'TRIAL_USED' });
  });

  it('the free trial is open until ANY allowance is used up', () => {
    expect(accessOf(sub(), { allowance, used: used({ transactions: 99 }) }, now)).toEqual({
      active: true,
      reason: 'TRIAL',
      limited: 'TRIAL',
    });
    expect(accessOf(sub(), { allowance, used: used({ callMinutes: 20 }) }, now)).toMatchObject({
      active: false,
      reason: 'TRIAL_USED',
    });
  });

  it('a customer who once paid never gets the trial back', () => {
    expect(
      accessOf(sub({ status: 'CANCELED', everPaid: true }), { allowance, used: used() }, now),
    ).toMatchObject({ active: false, reason: 'ENDED' });
  });

  it('no row, no trial data → NONE', () => {
    expect(accessOf(null, null, now)).toMatchObject({ active: false, reason: 'NONE' });
  });
});

describe('trialUsedUp', () => {
  it('lists every allowance at or over its limit', () => {
    expect(trialUsedUp(allowance, used({ texts: 16, transactions: 100 }))).toEqual([
      'transactions',
      'texts',
    ]);
    expect(trialUsedUp(allowance, used())).toEqual([]);
  });
});

describe('statusFromStripe', () => {
  it('maps every Stripe status', () => {
    expect(statusFromStripe('active')).toBe('ACTIVE');
    expect(statusFromStripe('past_due')).toBe('PAST_DUE');
    expect(statusFromStripe('incomplete_expired')).toBe('INCOMPLETE_EXPIRED');
    expect(statusFromStripe('weird')).toBe('NONE');
  });
});

describe('months (America/Toronto)', () => {
  it('a UTC instant just after midnight UTC on the 1st is still last month in Toronto', () => {
    expect(monthOf(new Date('2026-12-01T03:00:00Z'))).toBe('2026-11');
    expect(monthOf(new Date('2026-12-01T05:00:00Z'))).toBe('2026-12');
  });

  it('the next month starts at Toronto midnight (EST and EDT)', () => {
    expect(nextMonthStart(new Date('2026-11-25T15:00:00Z')).toISOString()).toBe(
      '2026-12-01T05:00:00.000Z',
    );
    expect(nextMonthStart(new Date('2026-06-10T15:00:00Z')).toISOString()).toBe(
      '2026-07-01T04:00:00.000Z',
    );
    expect(nextMonthStart(new Date('2026-12-20T15:00:00Z')).toISOString()).toBe(
      '2027-01-01T05:00:00.000Z',
    );
  });
});

describe('monthlyUsage', () => {
  it('warns at the percentage and stops at the limit', () => {
    expect(monthlyUsage(23_999, 30_000, 80)).toEqual({
      remaining: 6_001,
      reached: false,
      warn: false,
    });
    expect(monthlyUsage(24_000, 30_000, 80).warn).toBe(true);
    expect(monthlyUsage(30_500, 30_000, 80)).toMatchObject({
      remaining: 0,
      reached: true,
    });
  });
});

describe('freeUntilAfter', () => {
  it('adds months from today, or from a free period still running', () => {
    expect(freeUntilAfter(null, 2, now).toISOString()).toBe('2027-01-25T15:00:00.000Z');
    expect(
      freeUntilAfter(new Date('2027-03-01T00:00:00Z'), 1, now).toISOString(),
    ).toBe('2027-04-01T00:00:00.000Z');
    expect(
      freeUntilAfter(new Date('2026-01-01T00:00:00Z'), 1, now).toISOString(),
    ).toBe('2026-12-25T15:00:00.000Z');
  });
});
