import { type AssistantTexts, type FixedAssistantKey } from './instructions.util';
export type Channel = 'BOT' | 'SMS' | 'WHATSAPP' | 'EMAIL' | 'VOICE';
export declare const CHANNELS: readonly Channel[];
export declare const isChannel: (c: unknown) => c is Channel;
export declare const DEFAULT_INSTRUCTIONS: Record<FixedAssistantKey, string>;
export declare function channelStyle(channel: Channel): string;
export interface PromptInput {
    channel: Channel;
    today: string;
    bookLabel: string;
    rules: string;
    preferredContact?: string | null;
    attachment?: unknown;
    files?: unknown[];
}
export declare function systemPrompt(p: PromptInput, texts?: AssistantTexts): string;
export interface BookOption {
    companyId: number | null;
    name: string;
}
export declare function bookQuestion(options: readonly BookOption[]): string;
export declare function bookKey(name: string): string;
export declare function bookCandidates(text: string | null | undefined, options: readonly BookOption[]): BookOption[];
export declare function parseBookChoice(text: string | null | undefined, options: readonly BookOption[]): BookOption | null;
export declare function whichBookQuestion(found: readonly BookOption[], options: readonly BookOption[]): string;
export declare const isSwitchRequest: (text: string | null | undefined) => boolean;
