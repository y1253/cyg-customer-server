import type { PromoKind } from '@prisma/client';

/** Stripe refuses a card charge under 50 cents (CAD/USD). */
export const STRIPE_MIN_CENTS = 50;

export interface PromoLike {
  kind: PromoKind;
  /** FIXED_PRICE: the price in cents. PERCENT_OFF: the percentage off (1–100). */
  value: number;
  active: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  deletedAt: Date | null;
}

/** How promo codes are typed and stored: trimmed, upper-case. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Why a code can't be used right now (customer-readable), or null when it can. */
export function promoProblem(
  promo: PromoLike | null,
  now = new Date(),
): string | null {
  if (!promo || promo.deletedAt) return 'That promo code is not valid.';
  if (!promo.active) return 'That promo code is no longer active.';
  if (promo.expiresAt && promo.expiresAt.getTime() <= now.getTime())
    return 'That promo code has expired.';
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses)
    return 'That promo code has been fully used.';
  return null;
}

/**
 * What the customer pays, in cents. 0 stays 0 (free: Stripe is never called); anything
 * between 1 and 49 cents is raised to Stripe's 50-cent minimum.
 */
export function priceFor(
  listCents: number,
  promo: Pick<PromoLike, 'kind' | 'value'> | null,
): number {
  let cents = Math.max(0, Math.round(listCents));
  if (promo?.kind === 'FIXED_PRICE')
    cents = Math.max(0, Math.round(promo.value));
  if (promo?.kind === 'PERCENT_OFF') {
    const pct = Math.min(100, Math.max(0, promo.value));
    cents = Math.round((cents * (100 - pct)) / 100);
  }
  return cents > 0 && cents < STRIPE_MIN_CENTS ? STRIPE_MIN_CENTS : cents;
}
