import type { PrismaService } from '../prisma/prisma.service';
import { type BookScope } from './scope';
export declare function ensureSubName(prisma: PrismaService, scope: BookScope, parent: string, category: string, copyPicks?: boolean): Promise<{
    id: number;
    name: string;
}>;
export declare function ensureSplitSubName(prisma: PrismaService, scope: BookScope, parent: string, category: string, splitKey: string, label: string): Promise<{
    id: number;
    name: string;
}>;
export declare function copyParentPicks(prisma: PrismaService, scope: BookScope, parent: string, sub: string): Promise<void>;
export declare function wrapperNames(prisma: PrismaService, scope: BookScope): Promise<Map<string, number>>;
export declare function refuseWrapper(prisma: PrismaService, scope: BookScope, name: string | null | undefined): Promise<void>;
export declare function fileUnderSubNames(prisma: PrismaService, scope: BookScope): Promise<number>;
export declare function ledgerNameId(prisma: PrismaService, scope: BookScope, name: string): Promise<number>;
export declare function dropUnusedSubName(prisma: PrismaService, scope: BookScope, id: number | null): Promise<void>;
export declare function deleteSubName(prisma: PrismaService, id: number): Promise<void>;
export declare function syncParentSubNames(prisma: PrismaService, scope: BookScope, parentIds?: number[]): Promise<number>;
