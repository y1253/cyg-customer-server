import { type AiConversation } from '@prisma/client';
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
import { FileLinkService } from '../bookkeeping/file-links';
import { type Channel } from './assistant-prompt';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { RulesService } from './rules.service';
import { AiSchedulesStore } from '../schedules/ai-schedules.store';
import { type LinkBook } from './links.util';
import { CommunicationsHistory } from './communications-history.service';
import { CustomerOutbox } from './customer-outbox.service';
import { AiContactsService } from '../ai-contacts/ai-contacts.service';
export interface AgentAction {
    tool: string;
    ok: boolean;
    summary: string;
    ref?: Record<string, unknown>;
}
export interface ToolOutcome {
    content: string;
    action?: AgentAction;
    warning?: string;
    attachmentId?: number;
}
export interface IssueReport {
    complaint: string;
    whatWentWrong: string;
    attachmentIds: number[];
    transactionIds: number[];
}
export interface IssueOutcome {
    instructions: string;
    summary: string;
    ok: boolean;
}
export type IssueHandler = (ctx: ToolContext, report: IssueReport) => Promise<IssueOutcome>;
export type CallHandler = (ctx: ToolContext, about: string) => Promise<{
    ok: true;
    summary: string;
} | {
    ok: false;
    error: string;
}>;
export interface PersonTarget {
    phone: string;
    contactId: number | null;
    name: string | null;
}
export type PersonCallHandler = (ctx: ToolContext, person: PersonTarget, message: string) => Promise<{
    ok: true;
    summary: string;
} | {
    ok: false;
    error: string;
}>;
export interface ToolContext {
    scope: BookScope;
    messageId: number | null;
    conversation?: AiConversation;
    links?: LinkBook;
}
export declare const NOT_UNDERSTOOD_WARNING = "Filed where you said, but I couldn't see why it matches \u2014 please double-check.";
export declare const READ_TOOLS: ToolDefinition[];
export declare const ASSISTANT_TOOLS: ToolDefinition[];
export declare const WRITE_TOOL_NAMES: Set<string>;
export declare function toolsFor(channel: Channel): ToolDefinition[];
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
    private readonly links;
    private readonly messenger?;
    private readonly aiSchedules?;
    private readonly history?;
    private readonly outbox?;
    private readonly contacts?;
    constructor(prisma: PrismaService, bookkeeping: BookkeepingService, reports: ReportsService, tax: TaxService, accounts: CustomerAccountsService, attachments: AttachmentsService, processor: AttachmentProcessorService, names: NameMemoryService, splits: SplitsService, rules: RulesService, links: FileLinkService, messenger?: CustomerMessenger | undefined, aiSchedules?: AiSchedulesStore | undefined, history?: CommunicationsHistory | undefined, outbox?: CustomerOutbox | undefined, contacts?: AiContactsService | undefined);
    private readonly logger;
    private issueHandler;
    setIssueHandler(handler: IssueHandler): void;
    private callHandler;
    setCallHandler(handler: CallHandler): void;
    private personCallHandler;
    setPersonCallHandler(handler: PersonCallHandler): void;
    private readonly textsToOthers;
    private contactsService;
    private person;
    private schedulesStore;
    private schedulesList;
    run(name: string, rawArgs: string, ctx: ToolContext): Promise<ToolOutcome>;
    private exec;
    private switchBook;
    private fileAsStatement;
}
