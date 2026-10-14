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
    bankName?: string | null;
    nameCategories?: ReadonlyMap<string, string>;
    nameMemory?: ReadonlyMap<string, string>;
}
export declare function bankPayeeName(bankName: string | null | undefined): string | null;
export declare const isBankCharge: (category: string) => boolean;
export declare function isOwnersLoanMove(description: string, category: string): boolean;
export type NameSource = 'ai' | 'memory' | 'customer';
export interface Resolved {
    name: string | null;
    category: string;
    source: NameSource;
    followsName: boolean;
    learnable: boolean;
}
export declare function resolveRow(row: {
    description: string;
    name?: string | null;
    offsetAccount: string;
}, ctx: ResolveContext): Resolved;
export declare function resolveRows<T extends {
    description: string;
    name?: string | null;
    offsetAccount: string;
}>(rows: readonly T[], ctx: ResolveContext): {
    resolved: Resolved[];
    nameMemory: Map<string, string>;
};
export interface NameMemoryWrite {
    nameKey: string;
    sampleName: string;
    category: string;
}
export declare function nameMemoryWrites(resolved: readonly Resolved[], known: ReadonlyMap<string, string>): {
    creates: NameMemoryWrite[];
    fills: NameMemoryWrite[];
};
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
    nameCategories: Map<string, string>;
};
