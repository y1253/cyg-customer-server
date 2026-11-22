export declare const subNameOf: (parent: string, category: string) => string;
export declare const splitSubNameOf: (parent: string, category: string, label: string) => string;
export declare const splitLabelOf: (name: string, parent: string, category: string) => string;
export interface ParentRow {
    name: string | null;
    category: string;
    hasSplits: boolean;
    nameHasSubs?: boolean;
    current: {
        parent: string;
        category: string;
    } | null;
    fromRule?: boolean;
}
export declare function parentSubName(p: ParentRow): {
    want: {
        parent: string;
        category: string;
    } | null;
    change: boolean;
};
export interface FilingRow {
    id: number;
    name: string | null;
    category: string;
    subNameId: number | null;
}
export declare function subNameFiling(rows: readonly FilingRow[], wrappers: ReadonlyMap<string, number>, subs: ReadonlyMap<number, {
    nameId: number;
    category: string;
}>): {
    id: number;
    name: string;
    category: string;
}[];
