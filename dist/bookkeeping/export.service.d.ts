import { PrismaService } from '../prisma/prisma.service';
import { TaxService } from './tax.service';
export interface LedgerExportRow {
    pendingDate: Date | null;
    postingDate: Date | null;
    name: string;
    description: string;
    amount: number;
    debitAccount: string;
    creditAccount: string;
    statement: string;
    tax?: boolean;
}
export declare function netOf(rows: Array<{
    amount: number;
}>): number;
export declare class LedgerExportService {
    private readonly prisma;
    private readonly tax;
    constructor(prisma: PrismaService, tax: TaxService);
    rowsFor(customerId: number): Promise<LedgerExportRow[]>;
    excel(rows: LedgerExportRow[], customerName: string): Promise<Buffer>;
    pdf(rows: LedgerExportRow[], customerName: string): Promise<Buffer>;
}
