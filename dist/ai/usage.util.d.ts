export interface UsageTokens {
    input: number;
    cached: number;
    output: number;
    audioIn: number;
    audioOut: number;
    audioSeconds: number;
}
export interface ModelPrices {
    inputPerMTok: number | null;
    cachedInputPerMTok: number | null;
    outputPerMTok: number | null;
    audioInputPerMTok: number | null;
    audioOutputPerMTok: number | null;
    perMinute: number | null;
}
export type UsageKind = 'chat' | 'responses' | 'transcribe' | 'realtime';
export declare function parseUsage(kind: UsageKind, raw: unknown): UsageTokens | null;
export declare function isEmptyUsage(u: UsageTokens): boolean;
export declare function costOf(p: ModelPrices, u: UsageTokens): number | null;
export declare function pricesFromLiteLlm(list: Record<string, unknown>, model: string): ModelPrices | null;
export declare function samePrices(a: ModelPrices, b: ModelPrices): boolean;
