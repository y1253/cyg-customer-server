import type { PromoKind } from '@prisma/client';
export interface PromoLike {
    kind: PromoKind;
    freeMonths: number | null;
    active: boolean;
    expiresAt: Date | null;
    maxUses: number | null;
    usedCount: number;
    deletedAt: Date | null;
}
export declare function normalizeCode(code: string): string;
export declare function promoProblem(promo: PromoLike | null, now?: Date): string | null;
