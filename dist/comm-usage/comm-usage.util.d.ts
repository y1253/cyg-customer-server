export type CommChannel = 'SMS' | 'WHATSAPP';
export type CommDirection = 'IN' | 'OUT';
export type CommPurpose = 'ASSISTANT_REPLY' | 'SEND_MESSAGE' | 'SEND_TEXT' | 'TEXT_PERSON' | 'LOGIN_CODE' | 'SCHEDULE' | 'AI_SCHEDULE' | 'SIGNUP_OFFER' | 'CONTACT_RELAY' | 'INTAKE' | 'STRONG_AI' | 'FEATURE_DONE' | 'OTHER';
export interface CommPrices {
    smsOutPerSegment: number | null;
    smsInPerSegment: number | null;
    mmsOut: number | null;
    mmsIn: number | null;
    voiceOutPerMin: number | null;
    voiceInPerMin: number | null;
    recordingPerMin: number | null;
    whatsappOut: number | null;
    whatsappIn: number | null;
}
export declare const PRICE_FIELDS: ReadonlyArray<keyof CommPrices>;
export declare function pricesOf(row: Record<string, unknown>): CommPrices;
export declare function segmentsOf(body: string): number;
export declare function billedMinutes(durationSec: number): number;
export declare function messageCost(p: CommPrices, m: {
    channel: CommChannel;
    direction: CommDirection;
    segments: number;
    media: number;
}): number | null;
export declare function callCost(p: CommPrices, c: {
    direction: CommDirection;
    durationSec: number;
    recordingSec: number;
}): number | null;
export declare function billedPrice(v: unknown): number | null;
export declare function checkPagePrices(read: Partial<Record<keyof CommPrices, number | null>>, current: CommPrices): {
    ok: true;
    prices: CommPrices;
} | {
    ok: false;
    reason: string;
};
export declare function samePrices(a: CommPrices, b: CommPrices): boolean;
export declare function pageText(html: string, max?: number): string;
