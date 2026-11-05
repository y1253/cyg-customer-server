import type { DocumentBox } from './attachment-extractor';
export declare function cropPlan(boxes: ReadonlyArray<DocumentBox | null | undefined>): DocumentBox[] | null;
export declare function toPageBox(box: DocumentBox, width: number, height: number, margin?: number): [number, number, number, number];
