import { type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { type BookScope } from './scope';
import { type StatementProblem } from './statement-problem.util';
import { type StatementErrorView } from './statement-errors.util';
export type { StatementErrorView } from './statement-errors.util';
export declare class StatementErrorsService implements OnApplicationBootstrap {
    private readonly prisma;
    private readonly logger;
    private readonly queued;
    private readonly running;
    private timer;
    constructor(prisma: PrismaService);
    onApplicationBootstrap(): void;
    putInDateOrder(): Promise<void>;
    backfill(): Promise<void>;
    refreshSoon(scope: BookScope): void;
    refreshBook(scope: BookScope): Promise<number>;
    private refresh;
    check(scope: BookScope): Promise<Map<number, StatementProblem[]>>;
    openFor(scope: BookScope, statementIds?: number[]): Promise<Map<number, StatementErrorView[]>>;
    list(scope: BookScope, opts?: {
        statementId?: number;
        includeResolved?: boolean;
    }): Promise<StatementErrorView[]>;
    add(scope: BookScope, input: {
        statementId: number;
        title: string;
        text: string;
        note?: string;
    }): Promise<StatementErrorView>;
    resolve(scope: BookScope, errorId: number, note?: string): Promise<{
        resolved: boolean;
        reason?: string;
        error: StatementErrorView;
    }>;
}
