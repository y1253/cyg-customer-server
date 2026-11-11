export interface TextPiece {
    text: string;
    x: number;
    y: number;
    width: number;
    size: number;
}
export declare function layoutRows(pieces: readonly TextPiece[]): string;
export interface TextQuality {
    ok: boolean;
    reason: string | null;
}
export declare function pdfTextQuality(text: string): TextQuality;
export declare function pdfPageTexts(pdf: Buffer): Promise<string[] | null>;
export declare function piecesOf(json: string): TextPiece[];
export interface PrintedBalances {
    opening: string[];
    closing: string[];
}
export declare function printedBalanceLines(text: string): PrintedBalances;
