import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { NameMemoryService } from './name-memory.service';
import { StatementExtractor } from './statement-extractor';
import { StatementImagesService } from './statement-images.service';
import { TaxService } from './tax.service';
import { claimableAt, MAX_ATTEMPTS } from './queue-retry';
export { claimableAt, MAX_ATTEMPTS };
export declare class StatementProcessorService {
    private readonly prisma;
    private readonly storage;
    private readonly extractor;
    private readonly tax;
    private readonly names;
    private readonly images;
    private readonly logger;
    private sweeping;
    constructor(prisma: PrismaService, storage: ObjectStorageService, extractor: StatementExtractor, tax: TaxService, names: NameMemoryService, images: StatementImagesService);
    processSoon(): void;
    cleanStaging(): Promise<void>;
    sweep(): Promise<void>;
    private runSweep;
    private processOne;
    private recordFailure;
}
export declare function needsReviewMessage(rereads: number, problems: string[]): string;
