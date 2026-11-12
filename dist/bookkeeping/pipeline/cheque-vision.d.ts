import { type PxRect } from './cheque-vision.util';
export declare function cvAvailable(): Promise<boolean>;
export interface ChequeScan {
    width: number;
    height: number;
    rects: PxRect[];
}
export declare function scanCheques(file: Buffer, mimeType: string): Promise<ChequeScan | null>;
