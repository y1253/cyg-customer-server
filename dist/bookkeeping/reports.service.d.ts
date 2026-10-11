import { PrismaService } from '../prisma/prisma.service';
import { type ReportsView } from './reports.util';
import { CustomerAccountsService } from './customer-accounts.service';
import { TaxService } from './tax.service';
export declare class ReportsService {
    private readonly prisma;
    private readonly tax;
    private readonly accounts;
    constructor(prisma: PrismaService, tax: TaxService, accounts: CustomerAccountsService);
    reports(customerId: number, from: string | null, to: string | null): Promise<ReportsView>;
}
