import { StatementStatus, type AttachmentKind } from '@prisma/client';
import { Readable } from 'stream';
import { OpenAiClient } from '../ai/openai.client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { StatementProcessorService } from './statement-processor.service';
import { StatementImagesService } from './statement-images.service';
import { TaxService } from './tax.service';
import { type BookScope } from './scope';
import { FxService } from './fx.service';
export interface StatementView {
    id: number;
    filename: string;
    sizeBytes: number;
    status: StatementStatus;
    error: string | null;
    accountName: string | null;
    accountKind: string | null;
    currency: string | null;
    accountCurrency: string | null;
    bankName: string | null;
    label: string;
    periodStart: string | null;
    periodEnd: string | null;
    transactionCount: number;
    createdAt: Date;
    processedAt: Date | null;
    movedByCustomer: boolean;
    source: string;
    startingBalance?: {
        date: string | null;
        amount: number;
    } | null;
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
    kind?: 'opening' | 'tax' | 'split' | 'fx';
    taxRate?: number;
    taxAgencyId?: number;
    attachments?: Array<{
        id: number;
        kind: AttachmentKind;
        filename: string;
    }>;
    currency?: string;
    fxRate?: number | null;
    homeAmount?: number;
}
export declare class BookkeepingService {
    private readonly prisma;
    private readonly storage;
    private readonly openai;
    private readonly processor;
    private readonly tax;
    private readonly images;
    private readonly fx;
    private readonly logger;
    constructor(prisma: PrismaService, storage: ObjectStorageService, openai: OpenAiClient, processor: StatementProcessorService, tax: TaxService, images: StatementImagesService, fx: FxService);
    upload(scope: BookScope, files: Express.Multer.File[]): Promise<StatementView[]>;
    generateIfFree(scope: BookScope): Promise<{
        queued: number;
        taxing: boolean;
    }>;
    waitingCount(scope: BookScope): Promise<number>;
    generate(scope: BookScope): Promise<{
        queued: number;
        taxing: boolean;
    }>;
    list(scope: BookScope): Promise<StatementView[]>;
    transactions(scope: BookScope, statementIds?: number[]): Promise<TransactionView[]>;
    file(scope: BookScope, id: number): Promise<{
        stream: Readable;
        filename: string;
        size: number;
    }>;
    fileInfo(scope: BookScope, id: number): Promise<{
        storageKey: string;
        filename: string;
        size: number;
        generated: boolean;
    }>;
    private feedStatementPdf;
    retry(scope: BookScope, id: number): Promise<StatementView>;
    remove(scope: BookScope, id: number): Promise<void>;
    moveStatement(scope: BookScope, id: number, rawName: string): Promise<StatementView>;
    private owned;
}
