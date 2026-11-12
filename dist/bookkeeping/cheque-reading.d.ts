import type { AttachmentExtractor, AttachmentReading, DocumentBox } from './attachment-extractor';
import type { DocumentPipeline, Prepared } from './pipeline/document-pipeline';
import type { ChequeRegion } from './pipeline/tool-results';
export interface FoundCheque {
    box: DocumentBox;
    number: string | null;
}
export interface ChequeFind {
    regions: ChequeRegion[];
    cheques: FoundCheque[];
    by: 'opencv' | 'xy-cut';
    notCheques?: boolean;
}
export declare function findCheques(file: Buffer, mime: string, pipeline: Pick<DocumentPipeline, 'enabled' | 'readImage'>): Promise<ChequeFind | null>;
export declare function readAlone(found: ChequeFind): boolean;
export declare const ONE_CHEQUE_HINT: string;
export declare const CHEQUE_MIN_WIDTH_PX = 1400;
export declare function readChequesAlone(input: {
    file: Buffer;
    mime: string;
    cheques: readonly FoundCheque[];
    extractor: Pick<AttachmentExtractor, 'read'>;
    pipeline: Pick<DocumentPipeline, 'prepare'> | null;
    filename: string;
    today: string;
    message: string | null;
    hints: string;
    only?: number | null;
    withOcr?: (r: AttachmentReading, p: Prepared | null) => AttachmentReading;
}): Promise<AttachmentReading[] | null>;
