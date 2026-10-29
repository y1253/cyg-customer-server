import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
import type { ExtractedTransaction } from './ledger.util';
import type { ImagePage } from './pdf-images';
import { type ReconcileResult, type StatedFigures } from './reconcile.util';
import { UnreadableStatementError } from './statement-errors';
export declare const PAGES_PER_CHUNK = 1;
export declare const MAX_REREADS = 10;
export type AccountKind = 'BANK' | 'CREDIT_CARD';
export interface ExtractedStatement {
    accountName: string | null;
    accountNumber?: string | null;
    accountKind: AccountKind;
    currency: string | null;
    bankName: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    stated: StatedFigures;
    transactions: ExtractedTransaction[];
    verification: ReconcileResult;
    calls: number;
    rereads: number;
    signFixes: number;
    balanceFixes: number;
    imagePages: ImagePage[];
}
export interface PageReading {
    isBankStatement: boolean;
    hasItemImages?: boolean;
    accountName: string | null;
    accountNumber?: string | null;
    accountKind?: AccountKind | null;
    currency?: string | null;
    bankName: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    stated: StatedFigures;
    transactions: ExtractedTransaction[];
}
export { UnreadableStatementError };
export declare const EXTRACTION_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["bankName", "accountName", "accountNumber", "accountKind", "currency", "periodStart", "periodEnd", "openingBalance", "closingBalance", "totalDeposits", "totalWithdrawals", "depositCount", "withdrawalCount", "totalsScope", "transactions", "hasItemImages", "isBankStatement"];
    readonly properties: {
        readonly bankName: {
            type: string[];
        };
        readonly accountName: {
            type: string[];
        };
        readonly accountNumber: {
            type: string[];
        };
        readonly accountKind: {
            readonly type: readonly ["string", "null"];
            readonly enum: readonly ["BANK", "CREDIT_CARD", null];
        };
        readonly currency: {
            type: string[];
        };
        readonly periodStart: {
            type: string[];
        };
        readonly periodEnd: {
            type: string[];
        };
        readonly openingBalance: {
            type: string[];
        };
        readonly closingBalance: {
            type: string[];
        };
        readonly totalDeposits: {
            type: string[];
        };
        readonly totalWithdrawals: {
            type: string[];
        };
        readonly depositCount: {
            type: string[];
        };
        readonly withdrawalCount: {
            type: string[];
        };
        readonly totalsScope: {
            readonly type: "string";
            readonly enum: readonly ["all", "partial", "none"];
        };
        readonly transactions: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: readonly ["pendingDate", "postingDate", "description", "name", "amount", "balanceAfter", "offsetAccount"];
                readonly properties: {
                    readonly pendingDate: {
                        type: string[];
                    };
                    readonly postingDate: {
                        type: string[];
                    };
                    readonly description: {
                        readonly type: "string";
                    };
                    readonly name: {
                        type: string[];
                    };
                    readonly amount: {
                        readonly type: "number";
                    };
                    readonly balanceAfter: {
                        type: string[];
                    };
                    readonly offsetAccount: {
                        readonly type: "string";
                        readonly enum: readonly string[];
                    };
                };
            };
        };
        readonly hasItemImages: {
            readonly type: "boolean";
        };
        readonly isBankStatement: {
            readonly type: "boolean";
        };
    };
};
export declare const NAME_RULE = "name: the merchant, payee or payer in the description, as a short clean company or person name \u2014 e.g. \"WALMART SUPERCENTER #1234 TORONTO\" -> \"Walmart\", \"STRIPE TRANSFER ST-X9Y8\" -> \"Stripe\", \"GOOGLE *WORKSPACE\" -> \"Google Workspace\". Leave out store numbers, card digits, dates, cities and reference codes. null when no name can be identified (e.g. \"SERVICE CHARGE\", \"TRANSFER 0042\", \"INTEREST\").";
export declare const SYSTEM_PROMPT: string;
export declare class StatementExtractor {
    private readonly openai;
    private readonly config;
    private readonly logger;
    constructor(openai: OpenAiClient, config: ConfigService);
    model(): string;
    verifyModel(): string;
    extract(pdf: Buffer, filename: string, opts?: {
        pagesPerChunk?: number;
        maxRereads?: number;
        onRound?: (rereads: number) => Promise<void> | void;
        rules?: string;
    }): Promise<ExtractedStatement>;
    private pool;
    private readChunk;
}
export declare function emptyReading(): PageReading;
export declare function dropSpuriousPages(pages: readonly PageReading[]): {
    pages: number[];
    readings: PageReading[];
    result: ReturnType<typeof assemble>;
} | null;
export declare function assemble(pages: PageReading[]): Omit<ExtractedStatement, 'calls' | 'rereads'>;
export declare function closingOf(pages: PageReading[], openingBalance?: number | null): number | null;
export declare function rereadRound(n: number): {
    verifyModel: boolean;
    allPages: boolean;
};
export declare function better(a: ReconcileResult, b: ReconcileResult): boolean;
export declare function splitPdf(pdf: Buffer, pagesPerChunk: number, decrypt?: (pdf: Buffer) => Promise<Buffer>): Promise<Array<{
    bytes: Buffer;
    pages: number;
}>>;
export declare function looksLikeStatement(page: PageReading): boolean;
export declare function parseExtraction(reply: string): PageReading;
export declare function currencyCode(v: unknown): string | null;
