import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
import type { ExtractedTransaction } from './ledger.util';
export declare const PAGES_PER_CHUNK = 1;
export interface ExtractedStatement {
    accountName: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    transactions: ExtractedTransaction[];
}
export declare class UnreadableStatementError extends Error {
}
export declare const EXTRACTION_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["isBankStatement", "accountName", "periodStart", "periodEnd", "transactions"];
    readonly properties: {
        readonly isBankStatement: {
            readonly type: "boolean";
        };
        readonly accountName: {
            type: string[];
        };
        readonly periodStart: {
            type: string[];
        };
        readonly periodEnd: {
            type: string[];
        };
        readonly transactions: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: readonly ["pendingDate", "postingDate", "description", "amount", "offsetAccount"];
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
                    readonly amount: {
                        readonly type: "number";
                    };
                    readonly offsetAccount: {
                        readonly type: "string";
                        readonly enum: readonly string[];
                    };
                };
            };
        };
    };
};
export declare const SYSTEM_PROMPT: string;
export declare class StatementExtractor {
    private readonly openai;
    private readonly config;
    private readonly logger;
    constructor(openai: OpenAiClient, config: ConfigService);
    model(): string;
    extract(pdf: Buffer, filename: string): Promise<ExtractedStatement>;
    private readChunk;
}
export declare function splitPdf(pdf: Buffer, pagesPerChunk: number): Promise<Array<{
    bytes: Buffer;
    pages: number;
}>>;
export declare function parseExtraction(reply: string): ExtractedStatement & {
    isBankStatement: boolean;
};
