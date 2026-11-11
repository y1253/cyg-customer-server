import type { PrismaService } from '../prisma/prisma.service';
import { type OpeningStatement } from './opening-balance.util';
import { type BookScope } from './scope';
export declare function mismatchPairs(statements: OpeningStatement[] & {
    bridges?: OpeningStatement[];
}, accounts?: ReadonlySet<string>): number[];
export declare function queueChainRereads(prisma: PrismaService, scope: BookScope, accountNames: Array<string | null> | null): Promise<number>;
export declare function chainHint(statements: OpeningStatement[], id: number): string | null;
export declare function loadChainHint(prisma: PrismaService, scope: BookScope, row: Pick<OpeningStatement, 'id' | 'accountName' | 'accountKind' | 'periodStart' | 'periodEnd'> & {
    openingBalance: {
        toString(): string;
    } | null;
    closingBalance: {
        toString(): string;
    } | null;
}): Promise<string | null>;
