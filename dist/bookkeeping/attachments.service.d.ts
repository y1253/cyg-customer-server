import { AttachmentKind, AttachmentStatus } from '@prisma/client';
import type { Readable } from 'stream';
import { OpenAiClient } from '../ai/openai.client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import type { AttachmentReading } from './attachment-extractor';
import { AttachmentProcessorService } from './attachment-processor.service';
export interface AttachmentView {
    id: number;
    kind: AttachmentKind;
    status: AttachmentStatus;
    filename: string;
    mimeType: string;
    size: number;
    createdAt: Date;
    reading: AttachmentReading | null;
    total: number | null;
    matchNote: string | null;
    error: string | null;
    source: string;
    sourcePhone: string | null;
    message: string | null;
    transaction: {
        id: number;
        name: string | null;
        description: string;
        amount: number;
        date: string | null;
        statementId: number;
        statementLabel: string;
        splitCount: number;
    } | null;
}
export interface IntakeView {
    numbers: string[];
    phone: string | null;
    phoneSaved: boolean;
}
export declare class AttachmentsService {
    private readonly prisma;
    private readonly storage;
    private readonly openai;
    private readonly processor;
    constructor(prisma: PrismaService, storage: ObjectStorageService, openai: OpenAiClient, processor: AttachmentProcessorService);
    upload(customerId: number, files: Express.Multer.File[], transactionId: number | null): Promise<AttachmentView[]>;
    intake(customerId: number): Promise<IntakeView>;
    list(customerId: number): Promise<AttachmentView[]>;
    get(customerId: number, id: number): Promise<AttachmentView>;
    setTransaction(customerId: number, id: number, transactionId: number | null): Promise<AttachmentView>;
    applyItems(customerId: number, id: number): Promise<AttachmentView>;
    retry(customerId: number, id: number): Promise<AttachmentView>;
    remove(customerId: number, id: number): Promise<void>;
    file(customerId: number, id: number): Promise<{
        stream: Readable;
        filename: string;
        mimeType: string;
        size: number;
    }>;
    byTransaction(customerId: number, transactionIds: number[]): Promise<Map<number, Array<{
        id: number;
        kind: AttachmentKind;
        filename: string;
    }>>>;
    private owned;
    private parent;
}
