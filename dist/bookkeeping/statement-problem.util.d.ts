import type { Prisma } from '@prisma/client';
import type { StartDerived, StartReason } from './opening-balance.util';
import { type Check } from './reconcile.util';
export type ProblemKind = 'BALANCE' | 'ENDING' | 'RUNNING' | 'MISMATCH' | 'MISSING' | 'NO_OPENING' | 'NO_BALANCES';
export interface StatementProblem {
    kind: ProblemKind;
    title: string;
    text: string;
    details?: Record<string, unknown>;
}
export declare const PROBLEM_ORDER: ProblemKind[];
export declare const PROBLEM_TITLES: Record<ProblemKind, string>;
export interface ProblemInput {
    status: string;
    error: string | null;
    verification: string | null;
    verificationDetail: Prisma.JsonValue | null;
    source: string;
    openingBalance: number | null;
    closingBalance: number | null;
    net?: number;
    accountKind?: string | null;
    reason?: StartReason | null;
    rechecked?: boolean;
    rechecking?: boolean;
    printedEnding?: number | null;
    previousPrinted?: number | null;
    startDerived?: StartDerived;
}
export declare function statementProblem(s: ProblemInput): StatementProblem | null;
export declare function statementErrors(s: ProblemInput): StatementProblem[];
export declare function printedEnding(rows: Array<{
    balanceAfter: number | null;
    postingDate: string | null;
    amount?: number | null;
}>, card?: boolean): number | null;
export declare function needsReviewText(input: {
    rereads: number;
    checks: Check[];
    openingBalance: number | null;
    amounts: number[];
}): string;
export declare function money(n: number): string;
