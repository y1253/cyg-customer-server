import { PrismaService } from '../prisma/prisma.service';
import { type ReportsView } from './reports.util';
export declare class ReportsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    reports(customerId: number, from: string | null, to: string | null): Promise<ReportsView>;
}
