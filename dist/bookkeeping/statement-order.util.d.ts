export interface OrderRow {
    postingDate?: string | null;
    amount?: number | null;
    balanceAfter?: number | null;
}
export declare function runsNewestFirst(rows: ReadonlyArray<OrderRow>): boolean;
export declare function chronological<T extends OrderRow>(rows: T[]): T[];
export declare function balanceDirection(rows: ReadonlyArray<OrderRow>, card?: boolean): 1 | -1;
