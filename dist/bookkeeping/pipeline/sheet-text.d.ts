export declare const MAX_ROWS_PER_SHEET = 500;
export declare const MAX_SHEET_CHARS = 40000;
export declare function parseCsv(text: string): string[][];
export declare function sheetsToText(sheets: ReadonlyArray<{
    name: string;
    rows: string[][];
}>): string;
export declare function sheetText(file: Buffer, mime: string): Promise<string | null>;
