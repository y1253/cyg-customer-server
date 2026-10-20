import type { ToolDefinition } from '../ai/openai.client';
import { PrismaService } from '../prisma/prisma.service';
import { AttachmentProcessorService } from '../bookkeeping/attachment-processor.service';
import { AttachmentsService } from '../bookkeeping/attachments.service';
import { BookkeepingService } from '../bookkeeping/bookkeeping.service';
import { CustomerAccountsService } from '../bookkeeping/customer-accounts.service';
import { NameMemoryService } from '../bookkeeping/name-memory.service';
import { ReportsService } from '../bookkeeping/reports.service';
import { type BookScope } from '../bookkeeping/scope';
import { SplitsService } from '../bookkeeping/splits.service';
import { TaxService } from '../bookkeeping/tax.service';
import { RulesService } from './rules.service';
export interface AgentAction {
    tool: string;
    ok: boolean;
    summary: string;
}
export interface ToolOutcome {
    content: string;
    action?: AgentAction;
    warning?: string;
}
export interface ToolContext {
    scope: BookScope;
    messageId: number | null;
}
export declare const NOT_UNDERSTOOD_WARNING = "Filed where you said, but I couldn't see why it matches \u2014 please double-check.";
export declare const ASSISTANT_TOOLS: ToolDefinition[];
export declare const WRITE_TOOL_NAMES: Set<string>;
export declare class AssistantTools {
    private readonly prisma;
    private readonly bookkeeping;
    private readonly reports;
    private readonly tax;
    private readonly accounts;
    private readonly attachments;
    private readonly processor;
    private readonly names;
    private readonly splits;
    private readonly rules;
    constructor(prisma: PrismaService, bookkeeping: BookkeepingService, reports: ReportsService, tax: TaxService, accounts: CustomerAccountsService, attachments: AttachmentsService, processor: AttachmentProcessorService, names: NameMemoryService, splits: SplitsService, rules: RulesService);
    run(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolOutcome>;
    private exec;
    private fileAsStatement;
}
