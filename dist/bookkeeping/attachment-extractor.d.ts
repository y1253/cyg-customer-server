import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
import type { AttachmentClass } from './attachment-uploads';
import type { MatchCandidate } from './attachment-match.util';
export interface AttachmentReading {
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
    transcript?: string;
}
export declare class UnreadableAttachmentError extends Error {
}
export declare class AttachmentExtractor {
    private readonly openai;
    private readonly config;
    constructor(openai: OpenAiClient, config: ConfigService);
    private visionModel;
    private textModel;
    read(file: Buffer, filename: string, mime: string, cls: AttachmentClass, today: string, message?: string | null): Promise<AttachmentReading>;
    pick(reading: AttachmentReading, candidates: readonly MatchCandidate[], message?: string | null): Promise<{
        transactionId: number | null;
        confident: boolean;
        reason: string;
    }>;
    private ask;
}
export declare function cleanReading(r: AttachmentReading): AttachmentReading;
