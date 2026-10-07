import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { StatementExtractor } from './statement-extractor';
export declare const MAX_ATTEMPTS = 4;
export declare const MAX_RUNS = 3;
export declare function claimableAt(updatedAt: Date, attempts: number): number;
export declare class StatementProcessorService {
    private readonly prisma;
    private readonly storage;
    private readonly extractor;
    private readonly logger;
    private sweeping;
    constructor(prisma: PrismaService, storage: ObjectStorageService, extractor: StatementExtractor);
    processSoon(): void;
    cleanStaging(): Promise<void>;
    sweep(): Promise<void>;
    private runSweep;
    private processOne;
    private recordFailure;
}
