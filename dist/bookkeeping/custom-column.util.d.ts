export declare const CUSTOM_COLUMN_TYPES: readonly ["TEXT", "LETTERS", "NUMBER", "DROPDOWN"];
export type CustomColumnType = (typeof CUSTOM_COLUMN_TYPES)[number];
export declare const MAX_CUSTOM_COLUMNS = 20;
export declare const MAX_OPTIONS = 100;
export declare const MAX_ANSWER_CHARS = 1000;
export interface CustomColumnRules {
    type: CustomColumnType;
    minChars: number | null;
    maxChars: number | null;
}
export interface ColumnInput {
    name: string;
    type: string;
    minChars?: number | null;
    maxChars?: number | null;
    required?: boolean;
    options?: Array<{
        id?: number;
        label: string;
    }>;
}
export interface CleanColumn {
    name: string;
    type: CustomColumnType;
    minChars: number | null;
    maxChars: number | null;
    required: boolean;
    options: Array<{
        id?: number;
        label: string;
    }>;
}
export declare function cleanColumn(input: ColumnInput): CleanColumn | string;
export declare function answerProblem(rules: CustomColumnRules, raw: string): string | null;
