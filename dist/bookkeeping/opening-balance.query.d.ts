import type { PrismaService } from '../prisma/prisma.service';
import { type OpeningStatement } from './opening-balance.util';
export declare function loadOpeningStatements(prisma: PrismaService, customerId: number): Promise<Array<OpeningStatement & {
    bankName: string | null;
    filename: string;
    periodEnd: Date | null;
}>>;
