export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export interface ChartAccount {
    name: string;
    type: AccountType;
}
export declare const UNCATEGORIZED = "Uncategorized";
export declare const OWNERS_LOAN = "Owner's Loan";
export declare const CHART_OF_ACCOUNTS: readonly ChartAccount[];
export declare const ACCOUNT_NAMES: readonly string[];
export declare function normalizeAccount(name: unknown): string;
