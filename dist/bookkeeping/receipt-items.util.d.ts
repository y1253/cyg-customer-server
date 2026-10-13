export interface ReceiptItem {
    name: string;
    amount: number;
}
export interface ItemSplit {
    itemName: string;
    category: string;
    amount: number;
}
export declare function itemSplits(items: readonly ReceiptItem[], tax: number | null | undefined, bankAmount: number, categoryFor: (itemName: string) => string): {
    splits: ItemSplit[];
} | {
    problem: string;
};
export declare function itemKey(itemName: string): string;
