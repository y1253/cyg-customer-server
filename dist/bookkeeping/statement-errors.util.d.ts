import { type StatementProblem } from './statement-problem.util';
export interface StatementErrorView {
    id: number;
    statementId: number;
    kind: string;
    title: string;
    text: string;
    source: string;
    createdAt: string;
    resolvedAt: string | null;
    resolvedBy: string | null;
    note: string | null;
}
export interface OpenError {
    id: number;
    statementId: number;
    kind: string;
    title: string;
    text: string;
    source: string;
}
export interface ErrorPlan {
    create: Array<StatementProblem & {
        statementId: number;
    }>;
    update: Array<StatementProblem & {
        id: number;
    }>;
    resolve: number[];
}
export declare function diffErrors(open: OpenError[], found: ReadonlyMap<number, StatementProblem[]>): ErrorPlan;
export declare function orderErrors<T extends {
    kind: string;
    id: number;
}>(list: T[]): T[];
