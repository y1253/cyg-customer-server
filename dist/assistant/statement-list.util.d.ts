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
        id: number;
        label: string;
        status: string;
        account: string | null;
        periodStart: string | null;
        periodEnd: string | null;
        transactions: number;
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
