import type { TransactionView } from './bookkeeping.service';
export type SortDir = 'asc' | 'desc';
export type ColumnKind = 'text' | 'number' | 'date';
export interface SortState {
    key: string;
    dir: SortDir;
}
export interface ColumnFilter {
    text?: string;
    min?: number | null;
    max?: number | null;
    from?: string | null;
    to?: string | null;
}
export interface ColumnDef<T> {
    key: string;
    kind: ColumnKind;
    value: (row: T) => string | number | null;
}
export declare const isActive: (f: ColumnFilter | undefined) => boolean;
export declare function passes<T>(def: ColumnDef<T>, f: ColumnFilter | undefined, row: T): boolean;
export declare function compare<T>(def: ColumnDef<T>, a: T, b: T, dir: SortDir): number;
export declare function applyTable<T>(rows: T[], defs: ColumnDef<T>[], filters: Record<string, ColumnFilter>, sort: SortState | null): T[];
export interface LedgerQuery {
    q?: string;
    statementIds?: number[];
    account?: string;
    focusId?: number;
    name?: string;
    description?: string;
    subNameId?: number;
    from?: string;
    to?: string;
    filters?: Record<string, ColumnFilter>;
    sort?: SortState | null;
    folded?: boolean;
    near?: {
        amount?: number | null;
        date?: string | null;
    };
}
export interface QueryColumn {
    id: number;
    type: string;
}
export interface QueryContext {
    periodEnd: ReadonlyMap<number, string | null>;
    columns?: readonly QueryColumn[];
    answerText?: (columnId: number, transactionId: number) => string | null;
}
export type LedgerRow = TransactionView & {
    fullAmount?: number;
};
export interface CategoryTotal {
    category: string;
    rows: number;
    total: number;
    homeTotal: number;
}
export interface LedgerSummary {
    txCount: number;
    splitCount: number;
    allTx: number;
    net: number;
    homeNet: number | null;
    isAgency: boolean;
    families: number;
    byCategory: CategoryTotal[];
}
export declare function queryLedger(all: readonly TransactionView[], query: LedgerQuery, ctx: QueryContext): {
    families: LedgerRow[][];
    summary: LedgerSummary;
};
export declare function pageOfFamilies(families: LedgerRow[][], offset: number, limit: number): {
    rows: LedgerRow[];
    nextOffset: number | null;
};
