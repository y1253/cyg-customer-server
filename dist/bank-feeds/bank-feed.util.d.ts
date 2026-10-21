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
