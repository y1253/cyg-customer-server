export interface FeedTxn {
    id: string;
    date: string;
    cents: number;
}
export interface MonthPlan {
    periodStart: string;
    periodEnd: string;
    openingCents: number | null;
    closingCents: number | null;
    txnIds: string[];
}
export interface PlanInput {
    kind: 'BANK' | 'CREDIT_CARD';
    currentCents: number | null;
    today: string;
    txns: readonly FeedTxn[];
    covered?: ReadonlyArray<{
        start: string;
        end: string;
    }>;
    startDate?: string | null;
}
export declare function feedCents(plaidAmount: number | string): number;
export declare function monthOf(date: string): string;
export declare function planMonths(input: PlanInput): MonthPlan[];
export declare function monthLabel(periodStart: string): string;
export declare function kindOfPlaidType(type: string): 'BANK' | 'CREDIT_CARD';
export declare function defaultAccountName(institution: string | null, account: {
    name: string;
    mask: string | null;
}): string;
export declare function isoDay(d?: Date): string;
export interface PlaidUpdateStatus {
    last_successful_update?: string | null;
    last_failed_update?: string | null;
}
export interface BankHealth {
    updates?: string | null;
    openIncidents?: number;
}
export declare function bankDelayNote(institutionName: string | null, updates: PlaidUpdateStatus | null | undefined, health: BankHealth | null | undefined): string | null;
export declare const REFRESH_WINDOWS_UTC: Readonly<Record<string, readonly [number, number]>>;
export declare const AUTO_REFRESH_EVERY_MS: number;
export declare const MANUAL_REFRESH_EVERY_MS: number;
export type RefreshDecision = 'ok' | 'outside-window' | 'too-soon' | 'not-stuck';
export declare function shouldRequestRefresh(p: {
    now: Date;
    lastRefreshAt: Date | null;
    institutionId: string | null;
    failedWithoutSuccess: boolean;
    manual: boolean;
}): RefreshDecision;
export declare function refreshWindowNote(institutionName: string | null, institutionId: string | null, now?: Date): string | null;
