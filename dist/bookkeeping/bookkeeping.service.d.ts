import { StatementStatus, type AttachmentKind } from '@prisma/client';
import type { Readable } from 'stream';
import { OpenAiClient } from '../ai/openai.client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { StatementProcessorService } from './statement-processor.service';
import { StatementImagesService } from './statement-images.service';
import { TaxService } from './tax.service';
export interface StatementView {
    id: number;
    filename: string;
    sizeBytes: number;
    status: StatementStatus;
    error: string | null;
    accountName: string | null;
    bankName: string | null;
    label: string;
    periodStart: string | null;
    periodEnd: string | null;
    transactionCount: number;
    createdAt: Date;
    processedAt: Date | null;
}
export interface TransactionView {
    key: string;
    id: number;
    splitOfId?: number;
    statementId: number;
    pendingDate: string | null;
    postingDate: string | null;
    description: string;
    name: string | null;
    itemName?: string | null;
    amount: number;
    offsetAccount: string;
    debitAccount: string;
    creditAccount: string;
    statementLabel: string;
    kind?: 'opening' | 'tax' | 'split';
    taxRate?: number;
    taxAgencyId?: number;
    attachments?: Array<{
        id: number;
        kind: AttachmentKind;
        filename: string;
    }>;
}
export declare class BookkeepingService {
    private readonly prisma;
    private readonly storage;
    private readonly openai;
    private readonly processor;
    private readonly tax;
    private readonly images;
    private readonly logger;
    constructor(prisma: PrismaService, storage: ObjectStorageService, openai: OpenAiClient, processor: StatementProcessorService, tax: TaxService, images: StatementImagesService);
    upload(customerId: number, files: Express.Multer.File[]): Promise<StatementView[]>;
    generateIfFree(customerId: number): Promise<{
        queued: number;
        taxing: boolean;
    }>;
    waitingCount(customerId: number): Promise<number>;
    generate(customerId: number): Promise<{
        queued: number;
        taxing: boolean;
    }>;
    list(customerId: number): Promise<StatementView[]>;
    transactions(customerId: number, statementIds?: number[]): Promise<TransactionView[]>;
    file(customerId: number, id: number): Promise<{
        stream: Readable;
        filename: string;
        size: number;
    }>;
    retry(customerId: number, id: number): Promise<StatementView>;
    remove(customerId: number, id: number): Promise<void>;
    private owned;
}
