import { type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { type BookScope } from './scope';
import { type SplitRule } from './split-rules.util';
export interface ApplyTarget {
    ruleIds?: number[];
    names?: string[];
    transactionIds?: number[];
}
export declare class SplitRulesService implements OnApplicationBootstrap {
    private readonly prisma;
    private readonly accounts;
    private readonly logger;
    constructor(prisma: PrismaService, accounts: CustomerAccountsService);
    rules(scope: BookScope): Promise<Map<number, SplitRule>>;
    apply(scope: BookScope, target?: ApplyTarget): Promise<number>;
    applyToNew(scope: BookScope, transactionIds: number[]): Promise<void>;
    private ownRuleSubNames;
    private parentsFor;
    private lineOf;
    private write;
    onApplicationBootstrap(): void;
    convertAll(): Promise<void>;
    convertBook(scope: BookScope): Promise<number>;
    private typeContext;
}
