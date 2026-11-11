export declare function chequeNumberOf(description: string): string | null;
interface CaptionPage<T> {
    hasItemImages?: boolean;
    transactions: T[];
}
export declare function dropChequeCaptions<T extends {
    description: string;
    amount: number;
}, P extends CaptionPage<T>>(pages: readonly P[]): {
    pages: P[];
    dropped: number;
};
export {};
