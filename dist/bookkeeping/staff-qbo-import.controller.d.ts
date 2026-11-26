import { QboImportService, type ImportResult } from './qbo-import.service';
import type { ImportAnalysis } from './qbo-import.util';
import { type StaffBook } from './staff-book.guard';
declare class AnalyzeImportDto {
    since?: unknown;
    txns?: unknown;
}
declare class ApplyImportDto {
    plan?: unknown;
}
export declare class StaffQboImportController {
    private readonly imports;
    constructor(imports: QboImportService);
    analyze(_companyId: number, staff: StaffBook, dto: AnalyzeImportDto): Promise<ImportAnalysis>;
    apply(_companyId: number, staff: StaffBook, dto: ApplyImportDto): Promise<ImportResult>;
}
export {};
