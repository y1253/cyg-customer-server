export type CommChannel = 'WHATSAPP' | 'SMS' | 'EMAIL' | 'BOT' | 'UPLOADS';
export declare const COMM_CHANNELS: readonly CommChannel[];
export declare const isCommChannel: (c: unknown) => c is CommChannel;
export declare const MESSAGE_CHANNELS: readonly ["WHATSAPP", "SMS", "EMAIL", "BOT"];
export declare const FILE_SOURCE: Partial<Record<CommChannel, string>>;
export interface CommFile {
    type: 'attachment' | 'statement';
    id: number;
    filename: string;
    mimeType: string | null;
    status: string;
}
export interface CommItem {
    key: string;
    at: string;
    side: 'customer' | 'cyg';
    kind: 'message' | 'upload';
    text: string | null;
    files: CommFile[];
    warning?: string | null;
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
}): CommItem[];
export declare function pageOf(items: CommItem[], limit: number): {
    items: CommItem[];
    nextBefore: string | null;
};
export declare function previewOf(item: CommItem | undefined): string | null;
