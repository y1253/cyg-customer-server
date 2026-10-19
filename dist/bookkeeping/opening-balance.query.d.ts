import type { PrismaService } from '../prisma/prisma.service';
import { type OpeningStatement } from './opening-balance.util';
import { type BookScope } from './scope';
export declare function loadOpeningStatements(prisma: PrismaService, scope: BookScope): Promise<Array<OpeningStatement & {
    bankName: string | null;
    filename: string;
    periodEnd: Date | null;
    currency: string | null;
}>>;
export declare function accountCurrencies(prisma: PrismaService, scope: BookScope): Promise<Map<string, string>>;
export declare const effectiveCurrency: (s: {
    accountName: string | null;
    currency: string | null;
}, set: ReadonlyMap<string, string>) => string | null;
