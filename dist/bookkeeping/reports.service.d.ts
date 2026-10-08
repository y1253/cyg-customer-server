import { PrismaService } from '../prisma/prisma.service';
import { type ReportsView } from './reports.util';
import { TaxService } from './tax.service';
export declare class ReportsService {
    private readonly prisma;
    private readonly tax;
    constructor(prisma: PrismaService, tax: TaxService);
    reports(customerId: number, from: string | null, to: string | null): Promise<ReportsView>;
}
