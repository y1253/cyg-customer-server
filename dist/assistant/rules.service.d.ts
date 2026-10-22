import { PrismaService } from '../prisma/prisma.service';
import { type BookScope } from '../bookkeeping/scope';
import { InstructionsService } from './instructions.service';
import type { InstructionTarget } from './instructions.util';
import { type RuleTopic } from './rules.util';
export interface CustomerRuleView {
    id: number;
    text: string;
    topic: string;
    createdAt: string;
}
export declare class RulesService {
    private readonly prisma;
    private readonly instructions?;
    private readonly logger;
    constructor(prisma: PrismaService, instructions?: InstructionsService | undefined);
    promptBlock(scope: BookScope, topic?: RuleTopic, target?: InstructionTarget): Promise<string>;
    private rulesOnly;
    saveCustomerRule(scope: BookScope, text: string, topic: unknown, sourceMessageId?: number | null): Promise<boolean>;
    proposeGlobalRule(text: string, topic: unknown, sourceCustomerId: number, sourceMessageId?: number | null): Promise<boolean>;
    listCustomerRules(scope: BookScope): Promise<CustomerRuleView[]>;
    deleteCustomerRule(scope: BookScope, id: number): Promise<void>;
}
