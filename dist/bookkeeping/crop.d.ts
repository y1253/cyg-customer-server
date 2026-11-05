import type { DocumentBox } from './attachment-extractor';
export declare function cropImage(file: Buffer, mimeType: string, boxes: readonly DocumentBox[]): Promise<Buffer[]>;
