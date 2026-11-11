export interface StatementRow {
    id: number;
    label: string;
    status: string;
    accountName: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    transactionCount: number;
    error: string | null;
    createdAt: Date | string;
    openingBalance?: number | null;
    closingBalance?: number | null;
    verification?: string | null;
}
export interface StatementQuery {
    account?: string | null;
    from?: string | null;
    to?: string | null;
    status?: string | null;
    limit?: number | null;
}
export declare const DEFAULT_STATEMENT_LIMIT = 40;
export declare const MAX_STATEMENT_LIMIT = 100;
export declare const NOT_SORTED = "Not sorted yet";
export declare function listStatements(rows: StatementRow[], q?: StatementQuery): {
    statements: {
        error?: string | undefined;
        verification?: string | undefined;
        id: number;
        label: string;
        status: string;
        account: string | null;
        periodStart: string | null;
        periodEnd: string | null;
        transactions: number;
        openingBalance: number | null;
        closingBalance: number | null;
    }[];
    note?: string | undefined;
    total: number;
    accounts: {
        account: string;
        statements: number;
        latestPeriodEnd: string | null;
        notDone: number;
    }[];
    matched: number;
};
