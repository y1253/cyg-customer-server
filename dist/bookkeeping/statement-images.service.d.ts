import { type BankStatement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { AttachmentProcessorService } from './attachment-processor.service';
import { type ImagePage } from './pdf-images';
import { DocumentPipeline } from './pipeline/document-pipeline';
import { type BookScope } from './scope';
export declare const STATEMENT_SOURCE = "STATEMENT";
export declare class StatementImagesService {
    private readonly prisma;
    private readonly storage;
    private readonly attachments;
    private readonly pipeline?;
    private readonly logger;
    constructor(prisma: PrismaService, storage: ObjectStorageService, attachments: AttachmentProcessorService, pipeline?: DocumentPipeline | undefined);
    private isChequeLike;
    harvest(statement: Pick<BankStatement, 'id' | 'customerId' | 'bookId' | 'companyId' | 'filename' | 'accountName' | 'bankName'> & {
        periodStart: Date | null;
        periodEnd: Date | null;
        accountKind?: BankStatement['accountKind'];
    }, pdf: Buffer, pages: readonly ImagePage[]): Promise<void>;
    recut(scope: BookScope, statementId: number): Promise<boolean>;
    removeFor(scope: BookScope, statementId: number): Promise<void>;
    dropSiblingsOfDeleted(scope?: BookScope): Promise<number>;
    onApplicationBootstrap(): void;
}
export declare function recutPages(rows: ReadonlyArray<{
    sourceRef: string | null;
    extracted: unknown;
}>): ImagePage[];
