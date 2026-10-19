import type { PrismaService } from '../prisma/prisma.service';
import { type OpeningStatement } from './opening-balance.util';
export declare function loadOpeningStatements(prisma: PrismaService, customerId: number): Promise<Array<OpeningStatement & {
    bankName: string | null;
    filename: string;
    periodEnd: Date | null;
    currency: string | null;
}>>;
export declare function accountCurrencies(prisma: PrismaService, customerId: number): Promise<Map<string, string>>;
export declare const effectiveCurrency: (s: {
    accountName: string | null;
    currency: string | null;
}, set: ReadonlyMap<string, string>) => string | null;
