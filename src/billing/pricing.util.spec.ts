import {
  normalizeCode,
  priceFor,
  promoProblem,
  type PromoLike,
} from './pricing.util';

const promo = (over: Partial<PromoLike> = {}): PromoLike => ({
  kind: 'PERCENT_OFF',
  value: 50,
  active: true,
  expiresAt: null,
  maxUses: null,
  usedCount: 0,
  deletedAt: null,
  ...over,
});

describe('priceFor', () => {
  it('charges the list price with no promo', () => {
    expect(priceFor(1000, null)).toBe(1000);
  });

  it('a FIXED_PRICE code replaces the price, even above the list price', () => {
    expect(priceFor(1000, { kind: 'FIXED_PRICE', value: 300 })).toBe(300);
    expect(priceFor(1000, { kind: 'FIXED_PRICE', value: 1500 })).toBe(1500);
  });

  it('a PERCENT_OFF code takes the percentage off, rounded to the cent', () => {
    expect(priceFor(1000, { kind: 'PERCENT_OFF', value: 25 })).toBe(750);
    expect(priceFor(999, { kind: 'PERCENT_OFF', value: 50 })).toBe(500);
  });

  it('free stays free — 0 is never raised to the minimum', () => {
    expect(priceFor(0, null)).toBe(0);
    expect(priceFor(1000, { kind: 'FIXED_PRICE', value: 0 })).toBe(0);
    expect(priceFor(1000, { kind: 'PERCENT_OFF', value: 100 })).toBe(0);
  });

  it("raises 1–49 cents to Stripe's 50-cent minimum", () => {
    expect(priceFor(100, { kind: 'PERCENT_OFF', value: 90 })).toBe(50);
    expect(priceFor(1000, { kind: 'FIXED_PRICE', value: 1 })).toBe(50);
    expect(priceFor(30, null)).toBe(50);
  });

  it('clamps an out-of-range percentage', () => {
    expect(priceFor(1000, { kind: 'PERCENT_OFF', value: 150 })).toBe(0);
    expect(priceFor(1000, { kind: 'PERCENT_OFF', value: -10 })).toBe(1000);
  });
});

describe('promoProblem', () => {
  const now = new Date('2026-10-11T12:00:00Z');

  it('accepts a usable code', () => {
    expect(promoProblem(promo(), now)).toBeNull();
    expect(promoProblem(promo({ maxUses: 3, usedCount: 2 }), now)).toBeNull();
    expect(
      promoProblem(promo({ expiresAt: new Date('2026-10-12T00:00:00Z') }), now),
    ).toBeNull();
  });

  it('refuses a missing, deleted, inactive, expired or used-up code', () => {
    expect(promoProblem(null, now)).toMatch(/not valid/);
    expect(promoProblem(promo({ deletedAt: now }), now)).toMatch(/not valid/);
    expect(promoProblem(promo({ active: false }), now)).toMatch(
      /no longer active/,
    );
    expect(promoProblem(promo({ expiresAt: now }), now)).toMatch(/expired/);
    expect(promoProblem(promo({ maxUses: 2, usedCount: 2 }), now)).toMatch(
      /fully used/,
    );
  });
});

describe('normalizeCode', () => {
  it('trims and upper-cases', () => {
    expect(normalizeCode('  summer25 ')).toBe('SUMMER25');
  });
});
