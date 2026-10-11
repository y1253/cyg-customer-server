export type RuleMatchType = 'NAME' | 'DESCRIPTION';
export declare const RULE_MATCH_TYPES: readonly RuleMatchType[];
export declare function descriptionKey(description: string | null | undefined): string;
export declare function cleanName(name: string | null | undefined): string | null;
export declare const nameKey: (name: string) => string;
export interface MemoryEntry {
    name: string | null;
    category: string;
}
export interface NameRule {
    matchType: RuleMatchType;
    matchKey: string;
    name: string | null;
    category: string | null;
}
export interface ResolveContext {
    memory: ReadonlyMap<string, MemoryEntry>;
    descRules: ReadonlyMap<string, NameRule>;
    nameRules: ReadonlyMap<string, NameRule>;
    customAccounts?: ReadonlySet<string>;
}
export type NameSource = 'ai' | 'memory' | 'customer';
export interface Resolved {
    name: string | null;
    category: string;
    source: NameSource;
}
export declare function resolveRow(row: {
    description: string;
    name?: string | null;
    offsetAccount: string;
}, ctx: ResolveContext): Resolved;
export interface MemoryWrite {
    descriptionKey: string;
    sampleDescription: string;
    name: string | null;
    category: string;
}
export declare function memoryWrites(rows: ReadonlyArray<{
    description: string;
    name?: string | null;
    offsetAccount: string;
}>, memory: ReadonlyMap<string, MemoryEntry>): {
    creates: MemoryWrite[];
    fills: MemoryWrite[];
};
export declare function indexRules(rules: readonly NameRule[]): {
    descRules: Map<string, NameRule>;
    nameRules: Map<string, NameRule>;
};
