export declare const subNameOf: (parent: string, category: string) => string;
export interface ParentRow {
    name: string | null;
    category: string;
    hasSubSplits: boolean;
    current: {
        parent: string;
        category: string;
    } | null;
}
export declare function parentSubName(p: ParentRow): {
    want: {
        parent: string;
        category: string;
    } | null;
    change: boolean;
};
