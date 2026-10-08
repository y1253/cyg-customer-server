import { PrismaService } from '../prisma/prisma.service';
export interface LedgerExportRow {
    pendingDate: Date | null;
    postingDate: Date | null;
    name: string;
    description: string;
    amount: number;
    debitAccount: string;
    creditAccount: string;
    statement: string;
}
export declare function netOf(rows: Array<{
    amount: number;
}>): number;
export declare class LedgerExportService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    rowsFor(customerId: number): Promise<LedgerExportRow[]>;
    excel(rows: LedgerExportRow[], customerName: string): Promise<Buffer>;
    pdf(rows: LedgerExportRow[], customerName: string): Promise<Buffer>;
}
