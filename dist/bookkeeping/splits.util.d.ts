export declare function splitTotals(rows: ReadonlyArray<{
    splitOfId: number | null;
    amount: number;
}>): Map<number, number>;
export declare function remainderOf(row: {
    id: number;
    splitOfId: number | null;
    amount: number;
}, totals: ReadonlyMap<number, number>): number;
export declare function splitProblem(parentAmount: number, amounts: readonly number[]): string | null;
export declare function signedLike(parentAmount: number, amount: number): number;
