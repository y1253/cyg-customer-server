import { type AccountType } from './chart-of-accounts';
export interface ReportRow {
    amount: number;
    offsetAccount: string;
    bankAccount: string;
    date: string | null;
}
export interface OpeningBalance {
    bankAccount: string;
    amount: number;
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
}
export declare const OPENING_BALANCE_EQUITY = "Opening Balance Equity";
export declare const RETAINED_EARNINGS = "Retained Earnings";
export declare function buildReports(rows: ReportRow[], openings: OpeningBalance[], from?: string | null, to?: string | null): ReportsView;
