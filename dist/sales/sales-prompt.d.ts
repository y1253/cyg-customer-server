import type { ToolDefinition } from '../ai/openai.client';
import type { Pricing } from '../billing/pricing';
import { type FirmReach } from '../messaging/reach';
export type ProspectChannel = 'SMS' | 'WHATSAPP' | 'CALL';
export declare const OFFER_SIGNUP_TOOL: ToolDefinition;
export declare const TEXT_CALLER_TOOL: ToolDefinition;
export declare const MAX_CALL_TEXTS = 3;
export declare const SIGNUP_LINE = "Reply YES and we'll open your CYG Finance account on this number right away \u2014 no forms.";
export declare const CALL_SIGNUP_TEXT = "Thanks for calling CYG Finance! Reply YES to this text and we'll open your account on this number right away \u2014 no forms. Then text, WhatsApp or call this number anytime to send receipts and ask about your books.";
export declare const SALES_PITCH_DEFAULT: string;
export interface SalesTexts {
    pitch: string | null;
    extras: string;
}
export interface SalesPromptInput {
    channel: ProspectChannel;
    today: string;
    pricing: Pricing | null;
    reach: FirmReach | null;
    offered: boolean;
    language?: string;
    maxMinutes?: number;
}
export declare function priceWords(p: Pricing): string;
export declare function salesPrompt(input: SalesPromptInput, texts?: SalesTexts): string;
export declare function salesOpening(language: string): string;
export declare function withSignupLine(reply: string, offered: boolean): string;
export declare class DailyCounter {
    private day;
    private readonly counts;
    take(key: string, limit: number, now?: Date): boolean;
}
