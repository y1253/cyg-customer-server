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
