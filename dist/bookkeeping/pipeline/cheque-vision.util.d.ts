import type { DocumentBox } from '../attachment-extractor';
export interface PxRect {
    x: number;
    y: number;
    w: number;
    h: number;
}
export declare const MIN_ASPECT = 1.5;
export declare const MAX_ASPECT = 3.8;
export declare const MIN_AREA_SHARE = 0.025;
export declare const MAX_AREA_SHARE = 0.92;
export declare function chequeShaped(r: PxRect, width: number, height: number): boolean;
export declare function chequeRects(rects: readonly PxRect[], width: number, height: number): PxRect[];
export declare function inReadingOrder(rects: readonly PxRect[]): PxRect[];
export declare function sameRow(a: PxRect, b: PxRect): boolean;
export interface FoundCheque {
    front: PxRect;
    back: PxRect | null;
}
export declare function pairBacks(ordered: readonly PxRect[], isBack: readonly boolean[]): FoundCheque[];
export declare function cutBox(cheque: FoundCheque, all: readonly PxRect[], width: number, height: number, captionShare?: number): DocumentBox;
export declare function backColumn(ordered: readonly PxRect[], isBack: readonly boolean[], hasNumber: readonly boolean[]): boolean[];
