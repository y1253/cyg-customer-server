import { StatementStatus, type AttachmentKind, type Prisma } from '@prisma/client';
import { Readable } from 'stream';
import { OpenAiClient } from '../ai/openai.client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { type StartReason } from './opening-balance.util';
import { StatementProcessorService } from './statement-processor.service';
import { StatementImagesService } from './statement-images.service';
import { type StatementProblem } from './statement-problem.util';
import { TaxService } from './tax.service';
import { type BookScope } from './scope';
import { FxService } from './fx.service';
export interface StatementView {
    id: number;
    filename: string;
    sizeBytes: number;
    status: StatementStatus;
    error: string | null;
    errorDetail: string | null;
    checks: string[];
    customerNote: string | null;
    accountName: string | null;
    accountKind: string | null;
    currency: string | null;
    accountCurrency: string | null;
    bankName: string | null;
    label: string;
    periodStart: string | null;
    periodEnd: string | null;
    transactionCount: number;
    openingBalance: number | null;
    closingBalance: number | null;
    verification: string | null;
    createdAt: Date;
    processedAt: Date | null;
    movedByCustomer: boolean;
    source: string;
    startingBalance?: {
        date: string | null;
        amount: number;
        reason?: StartReason;
    } | null;
    problem: StatementProblem | null;
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
    exception?: {
        main: string;
    };
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
export interface StatementBalancesResult {
    statement: StatementView;
    advice?: string;
    balancesMatch: boolean | null;
    expectedClosing: number | null;
}
export declare function balanceFit(opening: number | null, closing: number | null, net: number, card: boolean): {
    balancesMatch: boolean | null;
    expectedClosing: number | null;
};
export declare function withBalanceCheck(detail: Prisma.JsonValue | null, fit: {
    balancesMatch: boolean | null;
    expectedClosing: number | null;
}, closing: number | null): Prisma.InputJsonValue;
export declare function failedChecks(detail: Prisma.JsonValue | null): string[];
export declare function appendNote(had: string | null, note: string): string;
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
    retry(scope: BookScope, id: number, note?: string, opts?: {
        append?: boolean;
    }): Promise<StatementView>;
    retryProblems(scope: BookScope): Promise<{
        queued: number;
    }>;
    sameAccountToRetry(scope: BookScope, id: number): Promise<number[]>;
    setBalances(scope: BookScope, id: number, input: {
        openingBalance?: number | null;
        closingBalance?: number | null;
        reason: string;
    }): Promise<StatementBalancesResult>;
    remove(scope: BookScope, id: number): Promise<void>;
    moveStatement(scope: BookScope, id: number, rawName: string): Promise<StatementView>;
    private owned;
}
export declare function rereadable(s: Pick<StatementView, 'status' | 'source' | 'problem'>): boolean;
