export type ProductSource = 'rule' | 'memory' | 'parent';
export interface ProductMemoryWrite {
    itemKey: string;
    sampleName: string;
    category: string;
}
export declare function resolveItem(key: string, rules: ReadonlyMap<string, string>, memory: ReadonlyMap<string, string>, parentCategory: string): {
    category: string;
    source: ProductSource;
};
export declare function itemsToAsk(names: readonly string[], rules: ReadonlyMap<string, string>, memory: ReadonlyMap<string, string>): Array<{
    key: string;
    name: string;
}>;
export declare function productMemoryWrites(answers: ReadonlyArray<{
    key: string;
    name: string;
    category: string;
}>, memory: ReadonlyMap<string, string>): {
    creates: ProductMemoryWrite[];
    fills: ProductMemoryWrite[];
};
export interface ProductView {
    itemKey: string;
    name: string;
    category: string;
    source: ProductSource;
    suggested: string | null;
    rows: number;
    total: number;
}
export declare function groupProducts(rows: ReadonlyArray<{
    id: number;
    itemName: string;
    amount: number;
    offsetAccount: string;
}>, rules: ReadonlyMap<string, string>, memory: ReadonlyMap<string, string>): ProductView[];
