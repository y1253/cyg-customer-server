export type Box = [number, number, number, number];
export interface ImagePage {
    page: number;
    hasRows: boolean;
}
export interface ItemImage {
    page: number;
    index: number;
    png: Buffer;
}
export declare function itemBoxes(boxes: readonly Box[], page: Box): Box[];
export declare function itemImages(pdf: Buffer, pages: readonly ImagePage[]): Promise<ItemImage[]>;
