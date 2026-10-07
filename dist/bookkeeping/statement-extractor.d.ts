import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
import type { ExtractedTransaction } from './ledger.util';
import { type ReconcileResult, type StatedFigures } from './reconcile.util';
import { UnreadableStatementError } from './statement-errors';
export declare const PAGES_PER_CHUNK = 1;
export declare const MAX_REREADS = 10;
export interface ExtractedStatement {
    accountName: string | null;
    bankName: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    stated: StatedFigures;
    transactions: ExtractedTransaction[];
    verification: ReconcileResult;
    calls: number;
    rereads: number;
}
export interface PageReading {
    isBankStatement: boolean;
    accountName: string | null;
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
    readonly required: readonly ["isBankStatement", "bankName", "accountName", "periodStart", "periodEnd", "openingBalance", "closingBalance", "totalDeposits", "totalWithdrawals", "depositCount", "withdrawalCount", "totalsScope", "transactions"];
    readonly properties: {
        readonly isBankStatement: {
            readonly type: "boolean";
        };
        readonly bankName: {
            type: string[];
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
                readonly required: readonly ["pendingDate", "postingDate", "description", "amount", "balanceAfter", "offsetAccount"];
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
    };
};
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
    }): Promise<ExtractedStatement>;
    private pool;
    private readChunk;
}
export declare function assemble(pages: PageReading[]): Omit<ExtractedStatement, 'calls' | 'rereads'>;
export declare function rereadRound(n: number): {
    verifyModel: boolean;
    allPages: boolean;
};
export declare function better(a: ReconcileResult, b: ReconcileResult): boolean;
export declare function splitPdf(pdf: Buffer, pagesPerChunk: number, decrypt?: (pdf: Buffer) => Promise<Buffer>): Promise<Array<{
    bytes: Buffer;
    pages: number;
}>>;
export declare function parseExtraction(reply: string): PageReading;
