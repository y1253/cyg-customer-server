export type AlertChannel = 'SMS' | 'WHATSAPP' | 'EMAIL';
export declare const ALERT_MAX_AGE_DAYS = 7;
export declare const ALERT_MAX_LINES = 10;
export declare function alertChannel(c: {
    preferred: string | null;
    phone: string | null;
    email: string | null;
    smsConfigured: boolean;
}): AlertChannel | null;
export declare function recentEnough(date: string, today: string): boolean;
export interface AlertRow {
    account: string;
    date: string;
    label: string;
    amount: number;
    category: string;
}
export declare function alertText(input: {
    book: string | null;
    rows: readonly AlertRow[];
}): string;
export declare const ALERT_EMAIL_SUBJECT = "New transactions in your books";
