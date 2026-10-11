import { PrismaService } from '../prisma/prisma.service';
import { type ExtractedTransaction } from './ledger.util';
import { type NameRule, type ResolveContext, type RuleMatchType } from './name-memory.util';
export declare class NameMemoryService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    contextFor(customerId: number, descriptions: readonly string[]): Promise<ResolveContext>;
    rulesOf(customerId: number): Promise<NameRule[]>;
    resolveStatement(customerId: number, rows: ExtractedTransaction[]): Promise<ExtractedTransaction[]>;
    private learn;
    saveRule(customerId: number, input: {
        matchType: RuleMatchType;
        matchKey: string;
        name: string | null;
        category: string | null;
    }): Promise<void>;
    resetRule(customerId: number, input: {
        matchType: RuleMatchType;
        matchKey: string;
    }): Promise<void>;
    private rewrite;
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
