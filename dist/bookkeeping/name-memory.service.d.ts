import { PrismaService } from '../prisma/prisma.service';
import { type ExtractedTransaction } from './ledger.util';
import { type BookScope } from './scope';
import { TaxService } from './tax.service';
import { type NameRule, type ResolveContext, type RuleMatchType } from './name-memory.util';
export type EditScope = 'ALWAYS' | 'ONCE';
export declare class NameMemoryService {
    private readonly prisma;
    private readonly tax;
    private readonly logger;
    constructor(prisma: PrismaService, tax: TaxService);
    contextFor(scope: BookScope, descriptions: readonly string[], names?: ReadonlyArray<string | null | undefined>): Promise<ResolveContext & {
        customAccounts: Set<string>;
    }>;
    private nameMemoryFor;
    rulesOf(scope: BookScope): Promise<NameRule[]>;
    private customAccountsOf;
    resolveStatement(scope: BookScope, rows: ExtractedTransaction[], bankName?: string | null): Promise<{
        lines: ExtractedTransaction[];
        customAccounts: Set<string>;
    }>;
    private learn;
    private learnNames;
    saveRule(scope: BookScope, input: {
        matchType: RuleMatchType;
        matchKey: string;
        name: string | null;
        category: string | null;
        scope?: EditScope;
    }): Promise<void>;
    editTransaction(scope: BookScope, id: number, input: {
        name: string | null;
        category: string | null;
        scope: EditScope;
    }): Promise<void>;
    private setNameCategory;
    categoryOfName(scope: BookScope, name: string): Promise<string | null>;
    private ruleKeyForName;
    resetRule(scope: BookScope, input: {
        matchType: RuleMatchType;
        matchKey: string;
    }): Promise<void>;
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
