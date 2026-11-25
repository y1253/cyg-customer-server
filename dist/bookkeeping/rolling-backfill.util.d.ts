import { type Check, type Verification } from './reconcile.util';
export interface StoredStatement {
    openingBalance: number | null;
    closingBalance: number | null;
    statedDeposits: number | null;
    statedWithdrawals: number | null;
    statedDepositCount: number | null;
    statedWithdrawalCount: number | null;
    verification: string | null;
    accountKind: string | null;
}
export interface StoredRow {
    id: number;
    amount: number;
    balanceAfter: number | null;
    postingDate: string | null;
    locked: boolean;
}
export interface StatementFix {
    flips: number[];
    balances: Array<{
        id: number;
        balanceAfter: number | null;
    }>;
    opening?: number;
    closing?: number;
    verification?: Verification;
    detail?: Array<Check & {
        text: string;
    }>;
    skipped?: string;
}
export declare const RANK: Record<string, number>;
export declare function planStatementFix(s: StoredStatement, rows: StoredRow[]): StatementFix;
export declare const changes: (f: StatementFix) => boolean;
