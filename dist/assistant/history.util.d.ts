export interface HistoryRow {
    id: number;
    channel: string;
    role: string;
    text: string;
    createdAt: Date;
    bookId: number;
    actions: unknown;
    files: {
        attachmentId: number;
        filename: string;
        removed: boolean;
    }[];
}
export declare const CHANNEL_LABEL: Record<string, string>;
export declare const OTHER_CHANNELS: {
    hours: number;
    maxRows: number;
    maxLine: number;
    maxChars: number;
};
export interface LinkRef {
    type: string;
    statementId?: number;
    attachmentId?: number;
    from?: string | null;
    to?: string | null;
    format?: string;
}
export declare function doneOf(raw: unknown): string[];
export declare function linksOf(raw: unknown): LinkRef[];
export declare function whenLabel(at: Date, tz?: string): string;
export declare function historyLine(r: HistoryRow, opts: {
    currentBookId: number;
    bookName: (id: number) => string;
}, maxLine?: number): string;
export declare function otherChannelsBlock(rows: HistoryRow[], opts: {
    now: Date;
    currentBookId: number;
    bookName: (id: number) => string;
}): string | null;
export declare function searchHit(r: HistoryRow, bookName: (id: number) => string): {
    done?: string[] | undefined;
    linksSent?: LinkRef[] | undefined;
    files?: {
        attachmentId: number;
        filename: string;
        removed: boolean;
    }[] | undefined;
    messageId: number;
    at: string;
    when: string;
    channel: string;
    book: string;
    who: string;
    text: string;
};
