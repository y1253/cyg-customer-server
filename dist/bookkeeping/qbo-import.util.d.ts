export interface QboHistoryLine {
    category: string;
    categoryType: string | null;
    cents: number;
}
export interface QboHistoryTxn {
    qboId: string;
    type: 'Purchase' | 'Deposit';
    date: string;
    cents: number;
    bankAccountId: string | null;
    bankAccountName: string | null;
    payee: string | null;
    lines: QboHistoryLine[];
}
export interface BookRow {
    id: number;
    date: string | null;
    cents: number;
    description: string;
    name: string | null;
    category: string;
    qboAccountId: string | null;
    accountName: string | null;
}
export interface ExistingRule {
    matchType: 'NAME' | 'DESCRIPTION';
    matchKey: string;
    name: string | null;
    category: string | null;
}
export interface CategoryCount {
    category: string;
    count: number;
}
export interface NameProposal {
    id: string;
    payee: string;
    categories: CategoryCount[];
    category: string | null;
    split: boolean;
    aliases: string[];
    descriptions: Array<{
        key: string;
        example: string;
        category: string;
        count: number;
    }>;
    count: number;
    skip: boolean;
}
export interface DescriptionProposal {
    id: string;
    key: string;
    example: string;
    payee: string;
    category: string | null;
    count: number;
    skip: boolean;
}
export type ImportQuestionKind = 'NAME_CATEGORIES' | 'DESCRIPTION_CONFLICT' | 'RULE_CONFLICT';
export interface ImportQuestion {
    id: string;
    kind: ImportQuestionKind;
    title: string;
    detail: string | null;
    options: Array<{
        value: string;
        label: string;
        detail?: string;
    }>;
    target: {
        type: 'name';
        id: string;
    } | {
        type: 'alias';
        id: string;
        alias: string;
    } | {
        type: 'name-category';
        id: string;
    } | {
        type: 'description';
        id: string;
    } | {
        type: 'description-choice';
        key: string;
        example: string;
    };
    choices?: Record<string, {
        payee: string;
        category: string | null;
    }>;
}
export interface ImportAnalysis {
    since: string | null;
    stats: {
        qboTransactions: number;
        bookRows: number;
        matched: number;
        payees: number;
    };
    names: NameProposal[];
    descriptions: DescriptionProposal[];
    questions: ImportQuestion[];
    categories: Array<{
        name: string;
        type: string | null;
    }>;
    matches: QboMatch[];
}
export interface QboMatch {
    qboId: string;
    transactionId: number;
    category: string;
    splits: Array<{
        id: number;
        category: string;
    }>;
}
export declare const SPLIT = "__SPLIT__";
export declare const SKIP = "__SKIP__";
export declare const OURS = "__OURS__";
export declare const QBO = "__QBO__";
export declare const MATCH_DAYS = 3;
export declare const nameKey: (name: string) => string;
export declare function cleanTxns(input: unknown): QboHistoryTxn[];
export declare function matchTxns(txns: readonly QboHistoryTxn[], rows: readonly BookRow[]): Map<string, BookRow>;
export declare function analyze(input: {
    since: string | null;
    txns: readonly QboHistoryTxn[];
    rows: readonly BookRow[];
    rules: readonly ExistingRule[];
}): ImportAnalysis;
export declare function accountTypeOf(qboType: string | null): 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export declare const isUncategorizedQbo: (name: string) => boolean;
