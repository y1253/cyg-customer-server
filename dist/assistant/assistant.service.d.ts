import { ConfigService } from '@nestjs/config';
import type { AiConversation, AiMessage } from '@prisma/client';
import { OpenAiClient } from '../ai/openai.client';
import { AttachmentsService } from '../bookkeeping/attachments.service';
import { type BookScope } from '../bookkeeping/scope';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantTools, type AgentAction } from './assistant-tools';
import { type Channel } from './assistant-prompt';
import { RulesService } from './rules.service';
export interface AssistantMessageView {
    id: number;
    role: 'USER' | 'ASSISTANT';
    channel: Channel;
    text: string;
    warning: string | null;
    actions: AgentAction[] | null;
    createdAt: string;
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
export declare function toMessageView(m: AiMessage): AssistantMessageView;
export declare class AssistantService {
    private readonly prisma;
    private readonly config;
    private readonly openai;
    private readonly tools;
    private readonly rules;
    private readonly attachments;
    private readonly logger;
    constructor(prisma: PrismaService, config: ConfigService, openai: OpenAiClient, tools: AssistantTools, rules: RulesService, attachments: AttachmentsService);
    get enabled(): boolean;
    assertEnabled(): void;
    private model;
    private dailyLimit;
    chat(scope: BookScope, text: string, conversationId?: number): Promise<ChatResult>;
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
    }): Promise<ChatResult>;
    private run;
    private overLimit;
    private bookLabel;
    save(conversation: AiConversation, role: 'USER' | 'ASSISTANT', text: string, extra?: {
        actions?: AgentAction[];
        warning?: string | null;
        attachmentIds?: number[];
    }): Promise<AiMessage>;
}
