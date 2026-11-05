export interface MergeSide {
    name: string;
    agency: boolean;
    folder: {
        kind: 'BANK' | 'CREDIT_CARD';
        currency: string | null;
    } | null;
}
export declare function mergeRefusal(from: MergeSide, into: MergeSide): string | null;
