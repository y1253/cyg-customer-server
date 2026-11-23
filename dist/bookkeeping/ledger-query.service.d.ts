import { PrismaService } from '../prisma/prisma.service';
import { BookkeepingService } from './bookkeeping.service';
import { CustomColumnsService } from './custom-columns.service';
import { type LedgerQuery, type LedgerRow, type LedgerSummary } from './ledger-query.util';
import { type BookScope } from './scope';
export interface LedgerPage {
    rows: LedgerRow[];
    nextOffset: number | null;
    families: number;
}
export declare class LedgerQueryService {
    private readonly prisma;
    private readonly bookkeeping;
    private readonly customColumns;
    constructor(prisma: PrismaService, bookkeeping: BookkeepingService, customColumns: CustomColumnsService);
    page(scope: BookScope, query: LedgerQuery, offset: number, limit: number): Promise<LedgerPage>;
    summary(scope: BookScope, query: LedgerQuery): Promise<LedgerSummary>;
    private run;
}
