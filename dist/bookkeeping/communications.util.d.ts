export type CommChannel = 'WHATSAPP' | 'SMS' | 'VOICE' | 'EMAIL' | 'BOT' | 'UPLOADS';
export declare const COMM_CHANNELS: readonly CommChannel[];
export declare const isCommChannel: (c: unknown) => c is CommChannel;
export declare const MESSAGE_CHANNELS: readonly ["WHATSAPP", "SMS", "VOICE", "EMAIL", "BOT"];
export declare const FILE_SOURCE: Partial<Record<CommChannel, string>>;
export interface CommFile {
    type: 'attachment' | 'statement';
    id: number;
    filename: string;
    mimeType: string | null;
    status: string;
}
export interface CommCall {
    id: number;
    direction: string;
    purpose: string;
    status: string;
    durationSec: number | null;
    hasRecording: boolean;
    answeredAt?: string | null;
    endedAt?: string | null;
    fromNumber?: string | null;
    toNumber?: string | null;
    withName?: string;
    contactName?: string | null;
    hasTranscript?: boolean;
}
export interface CommItem {
    key: string;
    at: string;
    side: 'customer' | 'cyg';
    kind: 'message' | 'upload' | 'call';
    text: string | null;
    files: CommFile[];
    warning?: string | null;
    call?: CommCall;
}
export interface CallIn extends CommCall {
    startedAt: Date;
}
export interface MessageIn {
    id: number;
    role: string;
    text: string;
    warning: string | null;
    attachmentIds: unknown;
    createdAt: Date;
}
export interface AttachmentIn {
    id: number;
    filename: string;
    mimeType: string;
    status: string;
    message: string | null;
    createdAt: Date;
}
export interface StatementIn {
    id: number;
    filename: string;
    status: string;
    createdAt: Date;
}
export declare function idsOf(json: unknown): number[];
export declare function buildTimeline(input: {
    messages: MessageIn[];
    files: ReadonlyMap<number, AttachmentIn>;
    loose: AttachmentIn[];
    statements: StatementIn[];
    calls?: CallIn[];
}): CommItem[];
export declare function pageOf(items: CommItem[], limit: number, cutoff?: string | null): {
    items: CommItem[];
    nextBefore: string | null;
};
export declare function previewOf(item: CommItem | undefined): string | null;
