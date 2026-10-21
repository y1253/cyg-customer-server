export interface PlaidJwk {
    kty: string;
    crv: string;
    x: string;
    y: string;
    kid?: string;
    alg?: string;
    expired_at?: number | null;
}
export declare const MAX_AGE_SECONDS: number;
export declare function webhookKeyId(token: string): string | null;
export declare function verifyPlaidWebhook(token: string, key: PlaidJwk, rawBody: Buffer, nowSeconds?: number): string | null;
