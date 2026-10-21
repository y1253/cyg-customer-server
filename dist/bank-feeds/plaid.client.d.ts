import { ConfigService } from '@nestjs/config';
export declare class PlaidApiError extends Error {
    readonly status: number;
    readonly type: string;
    readonly code: string;
    readonly displayMessage: string | null;
    constructor(status: number, type: string, code: string, message: string, displayMessage: string | null);
}
export interface PlaidAccountData {
    account_id: string;
    name: string;
    official_name: string | null;
    mask: string | null;
    type: string;
    subtype: string | null;
    balances: {
        current: number | null;
        available: number | null;
        iso_currency_code: string | null;
        unofficial_currency_code: string | null;
    };
}
export interface PlaidTransactionData {
    transaction_id: string;
    account_id: string;
    amount: number;
    iso_currency_code: string | null;
    unofficial_currency_code: string | null;
    date: string;
    authorized_date: string | null;
    name: string;
    merchant_name: string | null;
    pending: boolean;
    personal_finance_category?: {
        primary: string;
        detailed: string;
    } | null;
}
export declare class PlaidClient {
    private readonly config;
    constructor(config: ConfigService);
    private get;
    get configured(): boolean;
    get env(): string;
    get webhookUrl(): string | null;
    get redirectUri(): string | null;
    get linkCustomization(): string | null;
    get countryCodes(): string[];
    call<T>(path: string, body: Record<string, unknown>): Promise<T>;
}
