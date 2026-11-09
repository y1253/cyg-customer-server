export interface OcrBox {
    text: string;
    confidence: number;
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface OcrLine {
    text: string;
    confidence: number;
    boxes: OcrBox[];
}
export interface OcrResult {
    text: string;
    confidence: number;
    lines: OcrLine[];
    width: number;
    height: number;
}
export declare const MIN_LINE_CONFIDENCE = 0.85;
export declare const MIN_TEXT_CONFIDENCE = 0.88;
export declare function micrLine(r: OcrResult): OcrLine | null;
export declare function looksLikeChequeText(r: OcrResult): boolean;
export declare function chequeNumberFromOcr(r: OcrResult): string | null;
export declare function looksLikeChequeBack(r: OcrResult): boolean;
export declare function sideBySide(r: OcrResult): boolean;
export declare function severalCheques(r: OcrResult): boolean;
export type OcrVerdict = {
    ok: true;
    cheque: boolean;
} | {
    ok: false;
    cheque: boolean;
    reason: string;
};
export declare function ocrGate(r: OcrResult | null): OcrVerdict;
export declare function ocrText(r: OcrResult): string;
