export type Box = [number, number, number, number];
export interface ImagePage {
    page: number;
    hasRows: boolean;
}
export interface ItemImage {
    page: number;
    index: number;
    png: Buffer;
    caption: Caption | null;
    withBack: boolean;
}
export interface Caption {
    text: string;
    number: string | null;
    amount: number | null;
}
export declare function itemBoxes(boxes: readonly Box[], page: Box): Box[];
export declare function readingOrder(boxes: readonly Box[]): Box[];
export declare function isBackground(box: Box, page: Box): boolean;
export interface TextLine {
    box: Box;
    text: string;
}
export declare function parseCaption(text: string): Caption;
export declare function captionOver(box: Box, lines: readonly TextLine[]): TextLine | null;
export interface PlacedItem {
    box: Box;
    caption: Caption | null;
    withBack: boolean;
}
export declare function placeItems(boxes: readonly Box[], lines: readonly TextLine[]): PlacedItem[];
export declare function itemImages(pdf: Buffer, pages: readonly ImagePage[]): Promise<ItemImage[]>;
type Mupdf = typeof import('mupdf');
type MupdfPage = ReturnType<InstanceType<Mupdf['Document']>['loadPage']>;
export declare function renderClip(mupdf: Mupdf, p: MupdfPage, box: Box, scale: number): Buffer;
export {};
