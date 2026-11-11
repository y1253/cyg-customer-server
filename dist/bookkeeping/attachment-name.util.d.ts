export type FileBucket = 'RELATED' | 'DOCUMENT' | 'ERROR' | 'READING';
export interface NameInput {
    nameOverride: string | null;
    transaction: {
        name: string | null;
    } | null;
    reading: {
        vendor?: string | null;
        payee?: string | null;
        party?: string | null;
    } | null;
}
export declare function attachmentName(a: NameInput): string | null;
export declare const nameKeyOf: (name: string) => string;
export declare function fileBucket(status: string, onTransaction: boolean, unsorted: boolean): FileBucket;
