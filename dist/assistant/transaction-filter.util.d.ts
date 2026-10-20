export interface LedgerRow {
    id: number;
    kind?: 'opening' | 'tax' | 'split' | 'fx';
    postingDate: string | null;
    pendingDate: string | null;
    description: string;
    name: string | null;
    itemName?: string | null;
    amount: number;
    offsetAccount: string;
    statementLabel: string;
    attachments?: unknown[];
}
export interface TransactionQuery {
    from?: string | null;
    to?: string | null;
    name?: string | null;
    category?: string | null;
    text?: string | null;
    minAmount?: number | null;
    maxAmount?: number | null;
    direction?: 'in' | 'out' | null;
    limit?: number | null;
}
export interface FoundRow {
    id: number;
    split: boolean;
    date: string | null;
    name: string | null;
    description: string;
    amount: number;
    category: string;
    statement: string;
    attachments: number;
}
export declare const MAX_ROWS = 200;
export declare function filterTransactions(rows: readonly LedgerRow[], q: TransactionQuery): {
    count: number;
    total: number;
    rows: FoundRow[];
};
