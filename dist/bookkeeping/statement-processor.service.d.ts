import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { StatementExtractor } from './statement-extractor';
import { TaxService } from './tax.service';
export declare const MAX_ATTEMPTS = 4;
export declare function claimableAt(updatedAt: Date, attempts: number): number;
export declare class StatementProcessorService {
    private readonly prisma;
    private readonly storage;
    private readonly extractor;
    private readonly tax;
    private readonly logger;
    private sweeping;
    constructor(prisma: PrismaService, storage: ObjectStorageService, extractor: StatementExtractor, tax: TaxService);
    processSoon(): void;
    cleanStaging(): Promise<void>;
    sweep(): Promise<void>;
    private runSweep;
    private processOne;
    private recordFailure;
}
export declare function needsReviewMessage(rereads: number, problems: string[]): string;
