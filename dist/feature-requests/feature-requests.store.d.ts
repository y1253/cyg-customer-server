import type { FeatureRequest } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { BookScope } from '../bookkeeping/scope';
export declare const FEATURE_STATUSES: readonly ["OPEN", "PLANNED", "DONE", "DECLINED"];
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];
export declare const DEDUPE_MS: number;
export declare const SUMMARY_MAX = 200;
export declare const REQUEST_MAX = 4000;
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
export declare const TYPED_PER_DAY = 10;
export declare const TYPED_WINDOW_MS: number;
export declare function saveTypedRequest(prisma: PrismaService, customerId: number, input: {
    summary: string;
    request?: string;
}, now?: Date): Promise<FeatureRequest | null>;
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
