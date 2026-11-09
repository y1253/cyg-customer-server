import type { DocumentBox } from './attachment-extractor';
export interface PixelBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}
export declare function splitRegions(ink: Uint8Array, width: number, height: number): PixelBox[];
export declare function pageWhite(px: ArrayLike<number>, width: number, height: number, stride?: number): number;
export declare function chequeRegions(file: Buffer, mimeType: string): Promise<DocumentBox[]>;
