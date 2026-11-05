import { type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { type ExtractedTransaction } from './ledger.util';
import { type BookScope } from './scope';
import { TaxService } from './tax.service';
import { type NameRule, type ResolveContext } from './name-memory.util';
export type EditScope = 'ALWAYS' | 'ONCE';
export declare class NameMemoryService implements OnApplicationBootstrap {
    private readonly prisma;
    private readonly tax;
    private readonly logger;
    onApplicationBootstrap(): void;
    backfillProvenance(): Promise<number>;
    constructor(prisma: PrismaService, tax: TaxService);
    contextFor(scope: BookScope, descriptions: readonly string[], names?: ReadonlyArray<string | null | undefined>): Promise<ResolveContext & {
        customAccounts: Set<string>;
    }>;
    private nameMemoryFor;
    rulesOf(scope: BookScope): Promise<NameRule[]>;
    private customAccountsOf;
    resolveStatement(scope: BookScope, rows: ExtractedTransaction[], bankName?: string | null, statementId?: number): Promise<{
        lines: ExtractedTransaction[];
        customAccounts: Set<string>;
    }>;
    saveRule(scope: BookScope, input: Parameters<NameMemoryService['applyRule']>[1]): Promise<void>;
    editTransaction(scope: BookScope, id: number, input: Parameters<NameMemoryService['applyEdit']>[2]): Promise<void>;
    mergeNames(scope: BookScope, from: string, into: string): Promise<void>;
    resetRule(scope: BookScope, input: Parameters<NameMemoryService['applyReset']>[1]): Promise<void>;
    syncProvenance(scope: BookScope): Promise<void>;
    private saveException;
    private clearException;
    private learn;
    private learnNames;
    private applyRule;
    private saveContainsRule;
    private containsRows;
    private applyEdit;
    private setNameCategory;
    categoryOfName(scope: BookScope, name: string): Promise<string | null>;
    private ruleKeyForName;
    private applyMerge;
    private applyReset;
    private reresolveAfterContains;
    private upsertRule;
    private matchingRows;
    private writeRows;
}
export interface MatchedRow {
    id: number;
    description: string;
    name: string | null;
    amount: number;
    offsetAccount: string;
    debitAccount: string;
    creditAccount: string;
}
