import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { AttachmentExtractor, type AttachmentReading } from './attachment-extractor';
import type { AttachmentClass } from './attachment-uploads';
import { SplitsService } from './splits.service';
export declare function readingTotal(r: AttachmentReading): number | null;
export declare function classOf(mimeType: string): AttachmentClass;
export declare class AttachmentProcessorService {
    private readonly prisma;
    private readonly storage;
    private readonly extractor;
    private readonly splits;
    private readonly logger;
    private sweeping;
    constructor(prisma: PrismaService, storage: ObjectStorageService, extractor: AttachmentExtractor, splits: SplitsService);
    processSoon(): void;
    sweep(): Promise<void>;
    private runSweep;
    private processOne;
    private recordFailure;
    private match;
    private candidates;
    applyItems(customerId: number, attachmentId: number, replace: boolean): Promise<string | null>;
}
