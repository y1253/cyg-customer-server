import type { ReportsView } from './reports.util';
export declare function periodLabel(from: string | null, to: string | null): string;
export declare function reportPdf(view: ReportsView, owner: string): Promise<Buffer>;
