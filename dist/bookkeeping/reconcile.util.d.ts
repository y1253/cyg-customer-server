export interface StatedFigures {
    openingBalance: number | null;
    closingBalance: number | null;
    totalDeposits: number | null;
    totalWithdrawals: number | null;
    depositCount: number | null;
    withdrawalCount: number | null;
    totalsScope?: TotalsScope | null;
}
export type TotalsScope = 'all' | 'partial' | 'none';
export interface ReconcileRow {
    amount: number;
    balanceAfter: number | null;
    page: number;
}
export type CheckName = 'deposits' | 'withdrawals' | 'balance' | 'depositCount' | 'withdrawalCount' | 'runningBalance';
export interface Check {
    name: CheckName;
    expected: number;
    actual: number;
    ok: boolean;
    skipped: string | null;
}
export type Verification = 'VERIFIED' | 'UNVERIFIED' | 'MISMATCH';
export interface ReconcileResult {
    verification: Verification;
    checks: Check[];
    suspectPages: number[];
}
export declare const cents: (n: number) => number;
export declare function reconcile(stated: StatedFigures, rows: ReconcileRow[]): ReconcileResult;
export declare const score: (r: ReconcileResult) => number;
export declare function describeCheck(c: Check): string;
