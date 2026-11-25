import type { SubscriptionStatus } from '@prisma/client';
export type AccessReason = 'PAID' | 'PAST_DUE' | 'FREE' | 'TRIAL' | 'TRIAL_USED' | 'UNPAID' | 'ENDED' | 'NONE';
export interface Access {
    active: boolean;
    reason: AccessReason;
    limited: 'MONTHLY' | 'TRIAL' | null;
}
export interface SubscriptionLike {
    status: SubscriptionStatus;
    everPaid: boolean;
    freeForever: boolean;
    freeUntil: Date | null;
}
export interface TrialAllowance {
    transactions: number;
    texts: number;
    callMinutes: number;
}
export type TrialItem = keyof TrialAllowance;
export declare const TRIAL_ITEMS: readonly TrialItem[];
export declare function trialUsedUp(allowance: TrialAllowance, used: TrialAllowance): TrialItem[];
export declare function accessOf(sub: SubscriptionLike | null, trial: {
    allowance: TrialAllowance;
    used: TrialAllowance;
} | null, now?: Date): Access;
export declare function statusFromStripe(status: string): SubscriptionStatus;
export declare function monthOf(at?: Date): string;
export declare function nextMonthStart(at?: Date): Date;
export declare function monthlyUsage(used: number, limit: number, warnPercent: number): {
    remaining: number;
    warn: boolean;
    reached: boolean;
};
export declare function freeUntilAfter(current: Date | null, months: number, now?: Date): Date;
export declare const FREE_TEXT_PURPOSES: readonly string[];
export declare function lockedText(reason: AccessReason, usedUp?: TrialItem[]): string;
