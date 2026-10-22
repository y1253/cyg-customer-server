import type { ToolDefinition } from '../ai/openai.client';
export declare const VERDICTS: readonly ["FIXED", "NOT_AN_ISSUE", "UNSURE"];
export type Verdict = (typeof VERDICTS)[number] | 'FAILED';
export declare const SHARED_READ_TOOL_NAMES: Set<string>;
export declare const STRONG_TOOLS: ToolDefinition[];
export declare const WRITE_NAMES: Set<string>;
export interface StrongFinish {
    verdict: Verdict;
    summary: string;
    redo: string;
}
export declare function parseFinish(raw: string): StrongFinish;
export declare function settleVerdict(f: StrongFinish, changes: number): StrongFinish;
export declare function regularOutcome(f: StrongFinish): {
    instructions: string;
    summary: string;
    ok: boolean;
};
export declare function caseMessage(m: {
    id: number;
    role: string;
    text: string;
    actions: unknown;
    warning: string | null;
    createdAt: Date;
}): string;
