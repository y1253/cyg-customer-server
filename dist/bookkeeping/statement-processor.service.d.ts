import { RulesService } from '../assistant/rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { NameMemoryService } from './name-memory.service';
import { StatementExtractor } from './statement-extractor';
import { StatementImagesService } from './statement-images.service';
import { TaxService } from './tax.service';
import { claimableAt, MAX_ATTEMPTS } from './queue-retry';
import { type BookScope } from './scope';
export { claimableAt, MAX_ATTEMPTS };
export declare class StatementProcessorService {
    private readonly prisma;
    private readonly storage;
    private readonly extractor;
    private readonly tax;
    private readonly names;
    private readonly images;
    private readonly rules?;
    private readonly logger;
    private sweeping;
    constructor(prisma: PrismaService, storage: ObjectStorageService, extractor: StatementExtractor, tax: TaxService, names: NameMemoryService, images: StatementImagesService, rules?: RulesService | undefined);
    processSoon(): void;
    recheckChains(scope: BookScope, accountNames: Array<string | null> | null): Promise<void>;
    cleanStaging(): Promise<void>;
    sweep(): Promise<void>;
    private runSweep;
    private processOne;
    private knownAccounts;
    private recordFailure;
    private linkedReceipts;
    private relinkReceipts;
}
export declare function withCustomerNote(rules: string, note: string | null): string;
export declare function customerBalances(note: string | null): {
    opening: number | null;
    closing: number | null;
};
