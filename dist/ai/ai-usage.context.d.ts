export type AiFeature = 'ASSISTANT' | 'STRONG_AI' | 'INTAKE' | 'STATEMENT' | 'ATTACHMENT' | 'TRANSCRIBE' | 'PRODUCTS' | 'BANK_ROWS' | 'VOICE' | 'SCHEDULE' | 'SALES' | 'OTHER';
export interface AiUsageContext {
    customerId: number | null;
    bookId: number | null;
    companyId: number | null;
    feature: AiFeature;
}
export declare function withAiUsage<T>(ctx: Partial<AiUsageContext> & {
    feature: AiFeature;
}, fn: () => T): T;
export declare function currentAiUsage(): AiUsageContext;
