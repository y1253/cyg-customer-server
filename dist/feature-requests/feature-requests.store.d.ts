import type { PrismaService } from '../prisma/prisma.service';
import type { BookScope } from '../bookkeeping/scope';
export declare const FEATURE_STATUSES: readonly ["OPEN", "PLANNED", "DONE", "DECLINED"];
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];
export declare const DEDUPE_MS: number;
export declare const SUMMARY_MAX = 200;
export declare function cleanSummary(raw: string): string;
export declare function featureDoneText(summary: string, note: string | null): string;
export interface SaveFeatureRequestInput {
    scope: BookScope;
    conversationId: number | null;
    channel: string;
    messageId: number | null;
    request: string;
    summary: string;
}
export declare function saveFeatureRequest(prisma: PrismaService, input: SaveFeatureRequestInput, now?: Date): Promise<{
    id: number;
    summary: string;
}>;
export type DoneChannel = 'SMS' | 'EMAIL';
export declare function doneTarget(origin: {
    channel: string;
    peer: string | null;
}, smsConfigured: boolean, preferred: {
    channel: string | null;
    to: string | null;
}): {
    channel: DoneChannel;
    to: string;
} | null;
