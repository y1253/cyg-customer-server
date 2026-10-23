export declare const INSTRUCTION_TARGETS: readonly ["ASSISTANT", "ATTACHMENT_READER", "MATCHER", "STATEMENT_READER", "PRODUCT_CATEGORIZER", "BANK_FEED_CATEGORIZER"];
export type InstructionTarget = (typeof INSTRUCTION_TARGETS)[number];
export declare const isInstructionTarget: (t: unknown) => t is InstructionTarget;
export declare const TARGET_DESCRIPTIONS: Record<InstructionTarget, string>;
export declare const FIXED_ASSISTANT_KEYS: readonly ["core", "core.safety", "core.answers", "core.issues", "core.channels", "channel.BOT", "channel.SMS", "channel.WHATSAPP", "channel.EMAIL", "channel.VOICE", "contact", "ask_ai", "files", "core.requests"];
export type FixedAssistantKey = (typeof FIXED_ASSISTANT_KEYS)[number];
export declare const isFixedKey: (k: string) => k is FixedAssistantKey;
export declare const LOCKED_KEYS: readonly string[];
export declare const STRONG_KEYS: readonly ["strong.role", "strong.app_guide"];
export declare const MAX_INSTRUCTION_CHARS = 8000;
export declare const isExtraKey: (k: string) => boolean;
export declare function extraKeyFor(title: string): string;
export declare function cleanInstructionText(text: unknown): string | null;
export interface AssistantTexts {
    byKey: Partial<Record<FixedAssistantKey, string>>;
    extras: string[];
}
export declare const NO_TEXTS: AssistantTexts;
export interface InstructionRowLike {
    key: string;
    text: string;
    target: string;
    isStrong: boolean;
    sortOrder: number;
    id: number;
}
export declare function assistantTexts(rows: readonly InstructionRowLike[]): AssistantTexts;
export declare function extrasBlock(rows: readonly InstructionRowLike[], target: InstructionTarget): string;
export declare function fillPlaceholders(text: string, values: Record<string, string>): string;
