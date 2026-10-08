import { type AccountType } from './chart-of-accounts';
export interface ReportRow {
    amount: number;
    offsetAccount: string;
    bankAccount: string;
    date: string | null;
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
export declare const RETAINED_EARNINGS = "Retained Earnings";
export declare function buildReports(rows: ReportRow[], from?: string | null, to?: string | null): ReportsView;
