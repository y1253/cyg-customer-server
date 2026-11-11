export type RuleMatchType = 'NAME' | 'DESCRIPTION' | 'CONTAINS';
export declare const EXCEPTION = "EXCEPTION";
export declare const RULE_MATCH_TYPES: readonly RuleMatchType[];
export declare const CONTAINS_MIN = 3;
export declare const containsKey: (text: string) => string;
export declare const descriptionContains: (description: string, key: string) => boolean;
export declare function descriptionKey(description: string | null | undefined): string;
export declare function cleanName(name: string | null | undefined): string | null;
export declare function descriptionName(description: string): string | null;
export declare function fallbackName(name: string | null | undefined, category: string, description: string): string | null;
export declare const nameKey: (name: string) => string;
export interface MemoryEntry {
    id?: number;
    name: string | null;
    category: string;
}
export interface NameRule {
    id?: number;
    matchType: RuleMatchType | typeof EXCEPTION;
    matchKey: string;
    name: string | null;
    category: string | null;
    includeChars?: string | null;
}
export interface ResolveContext {
    memory: ReadonlyMap<string, MemoryEntry>;
    descRules: ReadonlyMap<string, NameRule>;
    nameRules: ReadonlyMap<string, NameRule>;
    containsRules?: readonly NameRule[];
    customAccounts?: ReadonlySet<string>;
    bankName?: string | null;
    nameCategories?: ReadonlyMap<string, string>;
    nameMemory?: ReadonlyMap<string, string>;
    exceptions?: ReadonlyMap<string, NameRule>;
    renamed?: ReadonlyMap<string, string>;
}
export declare function exceptionKey(row: {
    statementId: number;
    externalId?: string | null;
    postingDate: Date | string | null;
    pendingDate?: Date | string | null;
    amount: number | {
        toString(): string;
    };
    description: string;
}): string;
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
    generalRuleId: number | null;
    personalRuleId: number | null;
    exceptionRuleId: number | null;
    ruleName: string | null;
}
export declare function resolveRow(row: {
    description: string;
    name?: string | null;
    offsetAccount: string;
    exceptionKey?: string;
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
export declare const byContainsPriority: (a: {
    matchKey: string;
}, b: {
    matchKey: string;
}) => number;
export declare function containsRuleFor(description: string, rules: readonly NameRule[] | undefined): NameRule | undefined;
export declare function indexRules(rules: readonly NameRule[]): {
    descRules: Map<string, NameRule>;
    nameRules: Map<string, NameRule>;
    containsRules: NameRule[];
    nameCategories: Map<string, string>;
    exceptions: Map<string, NameRule>;
};
export declare const RULE_CONFLICT = "RULE_CONFLICT";
export interface LinkConflict {
    matchType: 'DESCRIPTION' | 'CONTAINS';
    text: string;
    name: string;
    ruleId?: number;
    remove: boolean;
}
export declare function findLinkConflicts(input: {
    matchType: 'DESCRIPTION' | 'CONTAINS';
    key: string;
    name: string;
    rules: readonly NameRule[];
    descriptions: readonly string[];
}): LinkConflict[];
export declare function rowNameConflicts(input: {
    matchType: 'DESCRIPTION' | 'CONTAINS';
    key: string;
    name: string;
    rows: ReadonlyArray<{
        description: string;
        name: string | null;
        manualEdit?: boolean;
    }>;
    ignore?: readonly string[];
    rules?: readonly NameRule[];
}): LinkConflict[];
export declare function linkConflictMessage(conflicts: readonly Pick<LinkConflict, 'text' | 'name'>[], name: string): string;
