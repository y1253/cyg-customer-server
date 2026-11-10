import { RulesService } from '../assistant/rules.service';
import { AttachmentKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { AttachmentExtractor, type AttachmentReading } from './attachment-extractor';
import { type MatchCandidate } from './attachment-match.util';
import { type AttachmentClass } from './attachment-uploads';
import { NameMemoryService } from './name-memory.service';
import { ProductMemoryService } from './product-memory.service';
import { SplitsService } from './splits.service';
import { type BookScope } from './scope';
import { DocumentPipeline, type Prepared } from './pipeline/document-pipeline';
export declare function siblingName(filename: string, n: number, total: number): string;
export declare function readingTotal(r: AttachmentReading): number | null;
export declare const siblingRef: (rowId: number, n: number) => string;
export declare function siblingOf(sourceRef: string | null | undefined): {
    rowId: number;
    index: number;
} | null;
export declare function kindFor(cls: AttachmentClass, reading: AttachmentReading): AttachmentKind;
export declare function sniffImageMime(b: Buffer): string | null;
export declare function customerNoteOf(extracted: unknown): string | null;
export declare function readerHints(source: string, note: string | null): string;
export declare function classOf(mimeType: string): AttachmentClass;
export declare const ONE_CHEQUE_HINT: string;
export declare function withOcrChequeNumber(reading: AttachmentReading, prepared: Prepared | null): AttachmentReading;
export declare class AttachmentProcessorService {
    private readonly prisma;
    private readonly storage;
    private readonly extractor;
    private readonly splits;
    private readonly products;
    private readonly names;
    private readonly rules?;
    private readonly pipeline?;
    private readonly logger;
    private sweeping;
    constructor(prisma: PrismaService, storage: ObjectStorageService, extractor: AttachmentExtractor, splits: SplitsService, products: ProductMemoryService, names: NameMemoryService, rules?: RulesService | undefined, pipeline?: DocumentPipeline | undefined);
    processSoon(): void;
    sweep(): Promise<void>;
    private runSweep;
    private processOne;
    private codeSplit;
    private readSplit;
    private finish;
    private fileSiblings;
    private cut;
    private storeOwnFile;
    family(ids: number[]): Promise<number[]>;
    waitUntilRead(ids: number[], timeoutMs?: number): Promise<boolean>;
    private nameFromCheque;
    private recordFailure;
    private match;
    lookAt(scope: BookScope, attachmentId: number, question: string): Promise<{
        answer: string | null;
        writtenOnIt: string | null;
        note?: string;
    } | {
        error: string;
    }>;
    candidatesFor(scope: BookScope, attachmentId: number, hints?: {
        from?: string | null;
        to?: string | null;
        amount?: number | null;
        text?: string | null;
    }, limit?: number): Promise<MatchCandidate[]>;
    private candidates;
    applyItems(scope: BookScope, attachmentId: number, replace: boolean): Promise<string | null>;
}
