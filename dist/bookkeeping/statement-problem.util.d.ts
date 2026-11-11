import type { Prisma } from '@prisma/client';
import type { StartReason } from './opening-balance.util';
import { type Check } from './reconcile.util';
export type ProblemKind = 'BALANCE' | 'MISMATCH' | 'MISSING' | 'NO_BALANCES';
export interface StatementProblem {
    kind: ProblemKind;
    title: string;
    text: string;
}
export declare const PROBLEM_TITLES: Record<ProblemKind, string>;
export interface ProblemInput {
    status: string;
    error: string | null;
    verification: string | null;
    verificationDetail: Prisma.JsonValue | null;
    source: string;
    openingBalance: number | null;
    closingBalance: number | null;
    reason?: StartReason | null;
    rechecked?: boolean;
    rechecking?: boolean;
}
export declare function statementProblem(s: ProblemInput): StatementProblem | null;
export declare function needsReviewText(input: {
    rereads: number;
    checks: Check[];
    openingBalance: number | null;
    amounts: number[];
}): string;
export declare function money(n: number): string;
