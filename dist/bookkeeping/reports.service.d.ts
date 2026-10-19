import { PrismaService } from '../prisma/prisma.service';
import { type ReportsView } from './reports.util';
import { CustomerAccountsService } from './customer-accounts.service';
import { FxService } from './fx.service';
import { type BookScope } from './scope';
import { TaxService } from './tax.service';
export declare class ReportsService {
    private readonly prisma;
    private readonly tax;
    private readonly accounts;
    private readonly fx;
    constructor(prisma: PrismaService, tax: TaxService, accounts: CustomerAccountsService, fx: FxService);
    reports(scope: BookScope, from: string | null, to: string | null): Promise<ReportsView>;
}
