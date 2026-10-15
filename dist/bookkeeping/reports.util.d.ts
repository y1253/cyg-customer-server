import { type AccountType } from './chart-of-accounts';
export declare const UNCLARIFIED_NAME = "Unclarified name";
export interface ReportRow {
    amount: number;
    offsetAccount: string;
    bankAccount: string | null;
    date: string | null;
    name?: string | null;
}
export interface ReportOptions {
    liabilityAccounts?: string[];
    customTypes?: ReadonlyMap<string, AccountType>;
    overrides?: ReadonlyMap<string, AccountType>;
    creditCards?: ReadonlySet<string>;
}
export interface AccountBalance {
    name: string;
    type: AccountType;
    bank: boolean;
    balance: number;
    count: number;
}
export interface ReportLine {
    name: string;
    amount: number;
    bank?: boolean;
    byName?: ReportLine[];
}
export interface ReportsView {
    from: string | null;
    to: string | null;
    accounts: AccountBalance[];
    incomeStatement: {
        income: ReportLine[];
        totalIncome: number;
        expenses: ReportLine[];
        totalExpenses: number;
        netIncome: number;
    };
    balanceSheet: {
        asOf: string | null;
        assets: ReportLine[];
        totalAssets: number;
        liabilities: ReportLine[];
        totalLiabilities: number;
        equity: ReportLine[];
        totalEquity: number;
        totalLiabilitiesAndEquity: number;
        balanced: boolean;
    };
    uncategorized: {
        count: number;
        amount: number;
    };
    moved: string[];
}
export declare const RETAINED_EARNINGS = "Retained Earnings";
export declare function buildReports(rows: ReportRow[], from?: string | null, to?: string | null, options?: ReportOptions): ReportsView;
