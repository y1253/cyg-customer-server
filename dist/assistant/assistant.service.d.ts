import { ConfigService } from '@nestjs/config';
import type { AiConversation, AiMessage } from '@prisma/client';
import { OpenAiClient } from '../ai/openai.client';
import { AttachmentProcessorService } from '../bookkeeping/attachment-processor.service';
import { AttachmentsService, type AttachmentView } from '../bookkeeping/attachments.service';
import { type BookScope } from '../bookkeeping/scope';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantTools, type AgentAction } from './assistant-tools';
import { type Channel } from './assistant-prompt';
import { InstructionsService } from './instructions.service';
import { RulesService } from './rules.service';
export interface MessageFileView {
    id: number;
    filename: string;
    role: string;
    live: boolean;
}
export interface AssistantMessageView {
    id: number;
    role: 'USER' | 'ASSISTANT';
    channel: Channel;
    text: string;
    warning: string | null;
    actions: AgentAction[] | null;
    createdAt: string;
    files?: MessageFileView[];
}
export interface ConversationView {
    id: number;
    channel: Channel;
    title: string | null;
    peer: string | null;
    attachmentId: number | null;
    lastMessageAt: string;
    preview: string | null;
}
export interface ChatResult {
    conversationId: number;
    message: AssistantMessageView;
    reply: AssistantMessageView;
}
export declare const MAX_TOOL_ROUNDS = 6;
export declare const HISTORY = 20;
export declare const FAILED_REPLY = "Sorry \u2014 I couldn't answer that right now. Please try again in a minute.";
export declare const CHAT_READ_WAIT_MS = 75000;
export declare function fileContext(a: AttachmentView): {
    id: number;
    filename: string;
    type: "PAYMENT_NOTE" | "BANK_STATEMENT" | import("@prisma/client").$Enums.AttachmentKind;
    status: import("@prisma/client").$Enums.AttachmentStatus;
    whatItIs: string | null;
    total: number | null;
    date: string | null;
    payee: string | null;
    filedTo: {
        id: number;
        name: string;
        amount: number;
        date: string | null;
    } | null;
    note: string | null;
    transcript: string | null;
};
export declare function toMessageView(m: AiMessage): AssistantMessageView;
export declare class AssistantService {
    private readonly prisma;
    private readonly config;
    private readonly openai;
    private readonly tools;
    private readonly rules;
    private readonly attachments;
    private readonly processor;
    private readonly instructions?;
    private readonly logger;
    constructor(prisma: PrismaService, config: ConfigService, openai: OpenAiClient, tools: AssistantTools, rules: RulesService, attachments: AttachmentsService, processor: AttachmentProcessorService, instructions?: InstructionsService | undefined);
    get enabled(): boolean;
    assertEnabled(): void;
    private model;
    private dailyLimit;
    chat(scope: BookScope, text: string, conversationId?: number, attachmentIds?: number[]): Promise<ChatResult>;
    fileLabel(n: number): string;
    filesContext(scope: BookScope, ids: number[]): Promise<unknown[]>;
    attachmentMessages(scope: BookScope, attachmentId: number): Promise<AssistantMessageView[]>;
    withFiles(rows: AiMessage[]): Promise<AssistantMessageView[]>;
    attachmentThread(scope: BookScope, attachmentId: number): Promise<{
        conversationId: number | null;
        messages: AssistantMessageView[];
    }>;
    attachmentChat(scope: BookScope, attachmentId: number, text: string): Promise<ChatResult>;
    conversations(scope: BookScope): Promise<ConversationView[]>;
    messages(scope: BookScope, conversationId: number): Promise<AssistantMessageView[]>;
    private ownConversation;
    respond(conversation: AiConversation, text: string, opts?: {
        attachment?: unknown;
        attachmentIds?: number[];
        files?: unknown[];
    }): Promise<ChatResult>;
    private run;
    promptFor(conversation: AiConversation, extra?: {
        attachment?: unknown;
        files?: unknown[];
        note?: string;
    }): Promise<string>;
    isOverLimit(customerId: number): Promise<boolean>;
    private overLimit;
    private preferredContact;
    private bookLabel;
    save(conversation: AiConversation, role: 'USER' | 'ASSISTANT', text: string, extra?: {
        actions?: AgentAction[];
        warning?: string | null;
        attachmentIds?: number[];
        actedOn?: number[];
    }): Promise<AiMessage>;
    private link;
}
