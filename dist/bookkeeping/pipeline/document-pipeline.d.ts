import { ConfigService } from '@nestjs/config';
import type { AttachmentClass } from '../attachment-uploads';
import { OcrService } from './ocr.service';
import { type OcrResult } from './ocr.util';
export type PipelineSource = 'OCR' | 'PDF_TEXT' | 'SHEET';
export interface Prepared {
    source: PipelineSource;
    ok: boolean;
    text: string;
    confidence: number | null;
    reason: string | null;
    cheque: boolean;
    chequeNumber: string | null;
}
export declare class DocumentPipeline {
    private readonly ocr;
    private readonly config;
    private readonly logger;
    constructor(ocr: OcrService, config: ConfigService);
    enabled(): boolean;
    readImage(image: Buffer): Promise<OcrResult | null>;
    prepare(file: Buffer, mime: string, cls: AttachmentClass, known?: OcrResult | null): Promise<Prepared | null>;
    fromOcr(r: OcrResult | null): Prepared | null;
    private sheet;
    private pdf;
}
export declare function pdfPagePngs(pdf: Buffer, max: number): Promise<Buffer[]>;
