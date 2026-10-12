import type { PromoKind } from '@prisma/client';
export declare const STRIPE_MIN_CENTS = 50;
export interface PromoLike {
    kind: PromoKind;
    value: number;
    active: boolean;
    expiresAt: Date | null;
    maxUses: number | null;
    usedCount: number;
    deletedAt: Date | null;
}
export declare function normalizeCode(code: string): string;
export declare function promoProblem(promo: PromoLike | null, now?: Date): string | null;
export declare function priceFor(listCents: number, promo: Pick<PromoLike, 'kind' | 'value'> | null): number;
