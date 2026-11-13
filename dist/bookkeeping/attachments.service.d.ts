import { ConfigService } from '@nestjs/config';
import { AttachmentKind, AttachmentStatus } from '@prisma/client';
import { Readable } from 'stream';
import { OpenAiClient } from '../ai/openai.client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { PictureEnhancerService } from '../storage/picture-enhancer.service';
import type { AttachmentReading } from './attachment-extractor';
import { AttachmentProcessorService } from './attachment-processor.service';
import { type FileBucket } from './attachment-name.util';
import { type BookScope } from './scope';
import { StatementImagesService } from './statement-images.service';
export declare const NOT_VOICE_MESSAGE: {
    NOT: {
        kind: "AUDIO";
        status: "DOCUMENT";
    };
};
export interface AttachmentView {
    id: number;
    fromStatementId: number | null;
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
    folder: string | null;
    messageCount: number;
    cropped: boolean;
    hasOriginal: boolean;
    siblings: number[];
    name: string | null;
    bucket: FileBucket;
    folderId: number | null;
    displayName: string | null;
    hasEmail: boolean;
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
    whatsapp: string[];
    phone: string | null;
    phoneSaved: boolean;
    email: string | null;
    voice: boolean;
}
export declare const cleanName: (s: string | null | undefined) => string | null;
export declare class AttachmentsService {
    private readonly prisma;
    private readonly storage;
    private readonly openai;
    private readonly processor;
    private readonly config?;
    private readonly images?;
    private readonly pictures?;
    constructor(prisma: PrismaService, storage: ObjectStorageService, openai: OpenAiClient, processor: AttachmentProcessorService, config?: ConfigService | undefined, images?: StatementImagesService | undefined, pictures?: PictureEnhancerService | undefined);
    private recutStatements;
    upload(scope: BookScope, files: Express.Multer.File[], transactionId: number | null, place?: {
        name?: string | null;
        folderId?: number | null;
    }): Promise<AttachmentView[]>;
    intake(scope: BookScope): Promise<IntakeView>;
    list(scope: BookScope): Promise<AttachmentView[]>;
    get(scope: BookScope, id: number): Promise<AttachmentView>;
    private groupOf;
    reread(scope: BookScope, id: number, note?: string): Promise<AttachmentView>;
    private readingOf;
    private messageCounts;
    chequeKeptOn(scope: BookScope, id: number, transactionId: number): Promise<string | null>;
    setTransaction(scope: BookScope, id: number, transactionId: number | null): Promise<AttachmentView>;
    applyItems(scope: BookScope, id: number): Promise<AttachmentView>;
    retryAll(scope: BookScope, ids: number[]): Promise<{
        queued: number;
    }>;
    retry(scope: BookScope, id: number): Promise<AttachmentView>;
    place(scope: BookScope, id: number, p: {
        name?: string | null;
        folderId?: number | null;
        displayName?: string | null;
    }): Promise<AttachmentView>;
    private folder;
    remove(scope: BookScope, id: number): Promise<void>;
    private storeUpload;
    file(scope: BookScope, id: number, original?: boolean, raw?: boolean): Promise<{
        stream: Readable;
        filename: string;
        mimeType: string;
        size: number;
    }>;
    byTransaction(scope: BookScope, transactionIds: number[]): Promise<Map<number, Array<{
        id: number;
        kind: AttachmentKind;
        filename: string;
    }>>>;
    private owned;
    private parent;
}
