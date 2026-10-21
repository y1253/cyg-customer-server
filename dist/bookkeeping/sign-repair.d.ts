export interface SignRow {
    amount: number;
    balanceAfter: number | null;
}
export interface SignRepair {
    amounts: number[];
    flips: number;
}
export interface BalanceRepair {
    balances: Array<number | null>;
    fixes: number;
}
export declare function repairBalanceSigns(rows: SignRow[], openingBalance: number | null): BalanceRepair;
export declare function repairSigns(rows: SignRow[], openingBalance: number | null): SignRepair;
export declare function segmentSigns(segment: number[], target: number): number[] | null;
export interface PrintedTotals {
    deposits: number | null;
    withdrawals: number | null;
    depositCount: number | null;
    withdrawalCount: number | null;
}
export declare function repairSignsFromTotals(rows: ReadonlyArray<{
    amount: number;
}>, totals: PrintedTotals): SignRepair;
