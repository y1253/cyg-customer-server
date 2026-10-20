import { RulesService } from '../assistant/rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { AttachmentExtractor, type AttachmentReading } from './attachment-extractor';
import { type MatchCandidate } from './attachment-match.util';
import type { AttachmentClass } from './attachment-uploads';
import { NameMemoryService } from './name-memory.service';
import { ProductMemoryService } from './product-memory.service';
import { SplitsService } from './splits.service';
import { type BookScope } from './scope';
export declare function readingTotal(r: AttachmentReading): number | null;
export declare function classOf(mimeType: string): AttachmentClass;
export declare class AttachmentProcessorService {
    private readonly prisma;
    private readonly storage;
    private readonly extractor;
    private readonly splits;
    private readonly products;
    private readonly names;
    private readonly rules?;
    private readonly logger;
    private sweeping;
    constructor(prisma: PrismaService, storage: ObjectStorageService, extractor: AttachmentExtractor, splits: SplitsService, products: ProductMemoryService, names: NameMemoryService, rules?: RulesService | undefined);
    processSoon(): void;
    sweep(): Promise<void>;
    private runSweep;
    private processOne;
    private nameFromCheque;
    private recordFailure;
    private match;
    candidatesFor(scope: BookScope, attachmentId: number, hints?: {
        from?: string | null;
        to?: string | null;
        amount?: number | null;
        text?: string | null;
    }, limit?: number): Promise<MatchCandidate[]>;
    private candidates;
    applyItems(scope: BookScope, attachmentId: number, replace: boolean): Promise<string | null>;
}
