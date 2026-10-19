import { PrismaService } from '../prisma/prisma.service';
import { FxService } from './fx.service';
import { type BookScope } from './scope';
import { TaxService } from './tax.service';
export interface LedgerExportRow {
    id: number | null;
    pendingDate: Date | null;
    postingDate: Date | null;
    name: string;
    description: string;
    amount: number;
    debitAccount: string;
    creditAccount: string;
    statement: string;
    tax?: boolean;
    split?: boolean;
    statementId?: number;
    currency?: string;
    fxRate?: number | null;
    homeAmount?: number;
}
export declare function netOf(rows: Array<{
    amount: number;
}>): number;
export declare function exportRowWithTaxes(row: Omit<LedgerExportRow, 'tax'>, offsetAccount: string, lines: Array<{
    agency: string;
    rate: number;
    name?: string | null;
}>): LedgerExportRow[];
export declare class LedgerExportService {
    private readonly prisma;
    private readonly tax;
    private readonly fx;
    constructor(prisma: PrismaService, tax: TaxService, fx: FxService);
    rowsFor(scope: BookScope): Promise<LedgerExportRow[]>;
    excel(rows: LedgerExportRow[], customerName: string): Promise<Buffer>;
    pdf(rows: LedgerExportRow[], customerName: string): Promise<Buffer>;
}
