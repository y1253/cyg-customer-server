import type { PrismaService } from '../prisma/prisma.service';
import { type BookScope } from './scope';
export interface FillTarget {
    transactionIds?: number[];
    names?: string[];
    subNameIds?: number[];
}
export interface NameDefault {
    columnId: number;
    nameKey: string | null;
    subNameId: number | null;
    value: string | null;
    dropDownId: number | null;
}
export declare function defaultFor(defaults: readonly NameDefault[], columnId: number, row: {
    name: string | null;
    subNameId: number | null;
}): NameDefault | null;
export declare function fillNameAnswers(prisma: PrismaService, scope: BookScope, target?: FillTarget): Promise<number>;
export declare function moveNameAnswers(prisma: PrismaService, from: {
    nameId?: number;
    subNameId?: number;
}, to: {
    nameId?: number;
    subNameId?: number;
}, remove?: boolean): Promise<void>;
