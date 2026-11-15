import { PrismaService } from '../prisma/prisma.service';
import { type ReportsView } from './reports.util';
import { CustomerAccountsService } from './customer-accounts.service';
import { FxService } from './fx.service';
import { type BookScope } from './scope';
import { StatementErrorsService } from './statement-errors.service';
import { TaxService } from './tax.service';
export declare class ReportsService {
    private readonly prisma;
    private readonly tax;
    private readonly accounts;
    private readonly fx;
    private readonly errors?;
    constructor(prisma: PrismaService, tax: TaxService, accounts: CustomerAccountsService, fx: FxService, errors?: StatementErrorsService | undefined);
    reports(scope: BookScope, from: string | null, to: string | null): Promise<ReportsView>;
    private accountErrors;
}
