export type Channel = 'BOT' | 'SMS' | 'WHATSAPP';
export declare const CHANNELS: readonly Channel[];
export declare const isChannel: (c: unknown) => c is Channel;
export declare function channelStyle(channel: Channel): string;
export interface PromptInput {
    channel: Channel;
    today: string;
    bookLabel: string;
    rules: string;
    attachment?: unknown;
}
export declare function systemPrompt(p: PromptInput): string;
export interface BookOption {
    companyId: number | null;
    name: string;
}
export declare function bookQuestion(options: readonly BookOption[]): string;
export declare function parseBookChoice(text: string | null | undefined, options: readonly BookOption[]): BookOption | null;
export declare const isSwitchRequest: (text: string | null | undefined) => boolean;
