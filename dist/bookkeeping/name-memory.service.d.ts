import { PrismaService } from '../prisma/prisma.service';
import { type ExtractedTransaction } from './ledger.util';
import { TaxService } from './tax.service';
import { type NameRule, type ResolveContext, type RuleMatchType } from './name-memory.util';
export type EditScope = 'ALWAYS' | 'ONCE';
export declare class NameMemoryService {
    private readonly prisma;
    private readonly tax;
    private readonly logger;
    constructor(prisma: PrismaService, tax: TaxService);
    contextFor(customerId: number, descriptions: readonly string[]): Promise<ResolveContext & {
        customAccounts: Set<string>;
    }>;
    rulesOf(customerId: number): Promise<NameRule[]>;
    private customAccountsOf;
    resolveStatement(customerId: number, rows: ExtractedTransaction[]): Promise<{
        lines: ExtractedTransaction[];
        customAccounts: Set<string>;
    }>;
    private learn;
    saveRule(customerId: number, input: {
        matchType: RuleMatchType;
        matchKey: string;
        name: string | null;
        category: string | null;
        scope?: EditScope;
    }): Promise<void>;
    editTransaction(customerId: number, id: number, input: {
        name: string | null;
        category: string | null;
        scope: EditScope;
    }): Promise<void>;
    private ruleKeyForName;
    resetRule(customerId: number, input: {
        matchType: RuleMatchType;
        matchKey: string;
    }): Promise<void>;
    private matchingRows;
    private writeRows;
    private carryTaxSwitch;
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
