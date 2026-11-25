import type { PromoKind } from '@prisma/client';

export interface PromoLike {
  kind: PromoKind;
  /** FREE_SUBSCRIPTION: months free; null = forever. */
  freeMonths: number | null;
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
