import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
import type { AttachmentClass } from './attachment-uploads';
import type { MatchCandidate } from './attachment-match.util';
import type { PipelineSource, Prepared } from './pipeline/document-pipeline';
export declare const DOCUMENT_TYPES: readonly ["RECEIPT", "INVOICE", "CHECK", "DEPOSIT_SLIP", "PAYMENT_NOTE", "BANK_STATEMENT", "DOCUMENT"];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export declare const isPaymentDocument: (t: DocumentType | undefined) => boolean;
export interface AttachmentReading {
    documentType?: DocumentType;
    summary?: string | null;
    kind: 'RECEIPT' | 'CHECK' | 'OTHER';
    vendor: string | null;
    date: string | null;
    subtotal: number | null;
    tax: number | null;
    total: number | null;
    items: Array<{
        name: string;
        amount: number;
    }>;
    checkNumber: string | null;
    payee: string | null;
    memo: string | null;
    category?: string | null;
    box?: DocumentBox | null;
    transcript?: string;
    text?: string | null;
    pipeline?: ReadingPipeline;
}
export interface ReadingPipeline {
    source: PipelineSource | null;
    model: 'text' | 'vision' | 'audio';
    confidence: number | null;
    reason: string | null;
    ocrChequeNumber?: string | null;
}
export interface DocumentBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}
export declare class UnreadableAttachmentError extends Error {
}
export declare const MAX_DOCUMENTS_PER_FILE = 10;
export declare class AttachmentExtractor {
    private readonly openai;
    private readonly config;
    private readonly logger;
    constructor(openai: OpenAiClient, config: ConfigService);
    private visionModel;
    private textModel;
    read(file: Buffer, filename: string, mime: string, cls: AttachmentClass, today: string, message?: string | null, rules?: string, prepared?: Prepared | null): Promise<AttachmentReading[]>;
    lookAt(file: Buffer, filename: string, mime: string, cls: 'image' | 'pdf', question: string): Promise<string>;
    pick(reading: AttachmentReading, candidates: readonly MatchCandidate[], message?: string | null, rules?: string): Promise<{
        transactionId: number | null;
        confident: boolean;
        reason: string;
    }>;
    private ask;
}
export declare const MAX_SHEET_PAYMENTS = 3;
export declare function sheetAsDocument(readings: readonly AttachmentReading[], prepared: Prepared): AttachmentReading;
export declare function tooThin(readings: readonly AttachmentReading[]): boolean;
export declare function cleanReadings(raw: unknown): AttachmentReading[];
export declare function cleanReading(r: AttachmentReading): AttachmentReading;
export declare function cleanBox(b: unknown): DocumentBox | null;
