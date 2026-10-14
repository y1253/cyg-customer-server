import { type BankStatement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { AttachmentProcessorService } from './attachment-processor.service';
import { type ImagePage } from './pdf-images';
export declare const STATEMENT_SOURCE = "STATEMENT";
export declare class StatementImagesService {
    private readonly prisma;
    private readonly storage;
    private readonly attachments;
    private readonly logger;
    constructor(prisma: PrismaService, storage: ObjectStorageService, attachments: AttachmentProcessorService);
    harvest(statement: Pick<BankStatement, 'id' | 'customerId' | 'filename' | 'accountName' | 'bankName'> & {
        periodStart: Date | null;
        periodEnd: Date | null;
    }, pdf: Buffer, pages: readonly ImagePage[]): Promise<void>;
    removeFor(customerId: number, statementId: number): Promise<void>;
}
