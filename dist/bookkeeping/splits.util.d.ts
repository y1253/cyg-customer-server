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
export interface FamilySplit {
    id: number;
    parentSplitId: number | null;
}
export declare function subtreeIds(rows: readonly FamilySplit[], id: number): number[];
export declare function splitTree<T extends FamilySplit>(rows: readonly T[]): Array<{
    row: T;
    depth: number;
}>;
export declare function childSplitProblem(available: number, next: number, parentLabel: string): string | null;
