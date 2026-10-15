export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export interface ChartAccount {
    name: string;
    type: AccountType;
}
export declare const UNCATEGORIZED = "Uncategorized";
export declare const OWNERS_LOAN = "Owner's Loan";
export declare const FX_GAIN_LOSS = "Exchange Gain or Loss";
export declare const CHART_OF_ACCOUNTS: readonly ChartAccount[];
export interface TypeContext {
    overrides?: ReadonlyMap<string, AccountType>;
    liabilities?: ReadonlySet<string>;
    custom?: ReadonlyMap<string, AccountType>;
}
export declare function typeFor(name: string, ctx?: TypeContext): AccountType;
export declare const ACCOUNT_NAMES: readonly string[];
export declare function normalizeAccount(name: unknown, extra?: Iterable<string>): string;
