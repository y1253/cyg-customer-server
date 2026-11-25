import { type PrismaClient } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { type StatementFix } from './rolling-backfill.util';
type Db = PrismaClient | PrismaService;
export interface BookReport {
    bookId: number;
    starts: Record<string, {
        before: number;
        after?: number;
    }>;
    fixed: Array<{
        statementId: number;
    } & Omit<StatementFix, 'detail'>>;
    skipped: Array<{
        statementId: number;
        why: string;
    }>;
    rereads: number[];
}
export declare function runRollingBackfill(db: Db, opts: {
    phase: 'fix' | 'reread';
    apply: boolean;
    bookId?: number;
}): Promise<BookReport[]>;
export declare function main(): Promise<void>;
export {};
