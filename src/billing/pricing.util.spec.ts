import {
  normalizeCode,
  promoProblem,
  type PromoLike,
} from './pricing.util';

const promo = (over: Partial<PromoLike> = {}): PromoLike => ({
  kind: 'FREE_SUBSCRIPTION',
  freeMonths: 2,
  active: true,
  expiresAt: null,
  maxUses: null,
  usedCount: 0,
  deletedAt: null,
  ...over,
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
