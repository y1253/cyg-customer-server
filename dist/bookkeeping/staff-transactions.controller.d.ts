import { PrismaService } from '../prisma/prisma.service';
import { QuickBooksSyncService } from '../quickbooks-sync/quickbooks-sync.service';
import { CustomerAccountsService, type AccountView } from './customer-accounts.service';
import { EditTransactionDto } from './dto/agency.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import { LedgerQueryService } from './ledger-query.service';
import type { LedgerSummary } from './ledger-query.util';
import { NameMemoryService } from './name-memory.service';
import { type StaffBook } from './staff-book.guard';
export interface StaffTransactionRow {
    key: string;
    id: number;
    kind: 'transaction' | 'split';
    splitOfId: number | null;
    date: string | null;
    name: string | null;
    subName: string | null;
    category: string;
    amount: number;
    fullAmount: number | null;
    account: string;
    qbo: {
        id: string | null;
        syncedAt: string | null;
        error: string | null;
    } | null;
}
export interface StaffTransactionPage {
    rows: StaffTransactionRow[];
    nextOffset: number | null;
}
export declare class StaffTransactionsController {
    private readonly ledgerQuery;
    private readonly accounts;
    private readonly nameMemory;
    private readonly qbo;
    private readonly prisma;
    private readonly logger;
    constructor(ledgerQuery: LedgerQueryService, accounts: CustomerAccountsService, nameMemory: NameMemoryService, qbo: QuickBooksSyncService, prisma: PrismaService);
    page(staff: StaffBook, dto: LedgerQueryDto): Promise<StaffTransactionPage>;
    summary(staff: StaffBook, dto: LedgerQueryDto): Promise<LedgerSummary>;
    categories(staff: StaffBook): Promise<AccountView[]>;
    edit(_companyId: number, id: number, staff: StaffBook, dto: EditTransactionDto): Promise<void>;
}
