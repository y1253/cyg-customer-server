import type { Prepared } from './document-pipeline';
export interface ChequeRegion {
    box: {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
    };
    chequeNumber: string | null;
    back: boolean;
}
export declare const TOOL_TEXT_CHARS = 8000;
export declare function toolResultsHint(prepared: Prepared | null, regions?: readonly ChequeRegion[]): string;
export declare function pageTextHint(text: string): string;
