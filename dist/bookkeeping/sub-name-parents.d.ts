import type { PrismaService } from '../prisma/prisma.service';
import { type BookScope } from './scope';
export declare function ensureSubName(prisma: PrismaService, scope: BookScope, parent: string, category: string): Promise<{
    id: number;
    name: string;
}>;
export declare function ledgerNameId(prisma: PrismaService, scope: BookScope, name: string): Promise<number>;
export declare function syncParentSubNames(prisma: PrismaService, scope: BookScope, parentIds?: number[]): Promise<number>;
