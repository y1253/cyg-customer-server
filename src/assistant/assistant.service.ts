import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiConversation, AiMessage, Prisma } from '@prisma/client';
import { OpenAiClient, type AgentMessage } from '../ai/openai.client';
import { AttachmentsService } from '../bookkeeping/attachments.service';
import { scopeWhere, type BookScope } from '../bookkeeping/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  ASSISTANT_TOOLS,
  AssistantTools,
  type AgentAction,
} from './assistant-tools';
import { systemPrompt, type Channel } from './assistant-prompt';
import { RulesService } from './rules.service';

/** What the website (and the internal staff log) shows for one message. */
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

/** Tool rounds per answer — after that the model must answer with what it has. */
export const MAX_TOOL_ROUNDS = 6;
/** Earlier messages the model sees. */
export const HISTORY = 20;
export const FAILED_REPLY =
  "Sorry — I couldn't answer that right now. Please try again in a minute.";

export function toMessageView(m: AiMessage): AssistantMessageView {
  return {
    id: m.id,
    role: m.role === 'USER' ? 'USER' : 'ASSISTANT',
    channel: m.channel as Channel,
    text: m.text,
    warning: m.warning,
    actions: Array.isArray(m.actions)
      ? (m.actions as unknown as AgentAction[])
      : null,
    createdAt: m.createdAt.toISOString(),
  };
}

/** What the model remembers of an earlier answer: its text plus what it changed. */
function historyText(m: AiMessage): string {
  const actions = Array.isArray(m.actions)
    ? (m.actions as unknown as AgentAction[])
    : [];
  const done = actions.filter((a) => a.ok).map((a) => a.summary);
  return done.length ? `${m.text}\n[Done: ${done.join('; ')}]` : m.text;
}

/**
 * The AI assistant (step11): one answer to one customer message, on any channel. It reads
 * the book's learned rules, runs tools on the conversation's BOOK (never another), applies
 * changes directly, and stores both messages — with what it changed — in `AiMessage`.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly openai: OpenAiClient,
    private readonly tools: AssistantTools,
    private readonly rules: RulesService,
    private readonly attachments: AttachmentsService,
  ) {}

  get enabled(): boolean {
    return this.config.get<string>('AI_ASSISTANT')?.trim() === '1';
  }

  assertEnabled(): void {
    if (!this.enabled)
      throw new ForbiddenException('The AI assistant is not turned on');
  }

  private model(): string {
    return (
      this.config.get<string>('OPENAI_ASSISTANT_MODEL')?.trim() || 'gpt-4.1'
    );
  }

  private dailyLimit(): number {
    const n = Number(this.config.get<string>('ASSISTANT_DAILY_LIMIT'));
    return Number.isFinite(n) && n > 0 ? n : 100;
  }

  // ---- the website chat -------------------------------------------------------------

  /** A website message: continues `conversationId` (of this book) or starts a new chat. */
  async chat(
    scope: BookScope,
    text: string,
    conversationId?: number,
  ): Promise<ChatResult> {
    this.assertEnabled();
    const conversation = conversationId
      ? await this.ownConversation(scope, conversationId)
      : await this.prisma.aiConversation.create({
          data: {
            ...scopeWhere(scope),
            channel: 'BOT',
            title: text.slice(0, 60),
          },
        });
    return this.respond(conversation, text);
  }

  /** The "Ask AI" thread of one attachment ({ null, [] } before the first message). */
  async attachmentThread(
    scope: BookScope,
    attachmentId: number,
  ): Promise<{
    conversationId: number | null;
    messages: AssistantMessageView[];
  }> {
    await this.attachments.get(scope, attachmentId); // 404 when not this book's
    const c = await this.prisma.aiConversation.findFirst({
      where: { ...scopeWhere(scope), channel: 'BOT', attachmentId },
      orderBy: { id: 'desc' },
    });
    return {
      conversationId: c?.id ?? null,
      messages: c ? await this.messages(scope, c.id) : [],
    };
  }

  async attachmentChat(
    scope: BookScope,
    attachmentId: number,
    text: string,
  ): Promise<ChatResult> {
    this.assertEnabled();
    const file = await this.attachments.get(scope, attachmentId);
    const conversation =
      (await this.prisma.aiConversation.findFirst({
        where: { ...scopeWhere(scope), channel: 'BOT', attachmentId },
        orderBy: { id: 'desc' },
      })) ??
      (await this.prisma.aiConversation.create({
        data: {
          ...scopeWhere(scope),
          channel: 'BOT',
          attachmentId,
          title: `About ${file.filename}`.slice(0, 120),
        },
      }));
    return this.respond(conversation, text, {
      attachment: {
        id: file.id,
        filename: file.filename,
        kind: file.kind,
        status: file.status,
        whyNotMatched: file.matchNote ?? file.error,
        reading: file.reading,
        total: file.total,
        texted: file.message,
        attachedTo: file.transaction,
      },
    });
  }

  async conversations(scope: BookScope): Promise<ConversationView[]> {
    const rows = await this.prisma.aiConversation.findMany({
      where: scopeWhere(scope),
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: {
        messages: { orderBy: { id: 'desc' }, take: 1, select: { text: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      channel: c.channel as Channel,
      title: c.title,
      peer: c.peer,
      attachmentId: c.attachmentId,
      lastMessageAt: c.lastMessageAt.toISOString(),
      preview: c.messages[0]?.text.slice(0, 120) ?? null,
    }));
  }

  async messages(
    scope: BookScope,
    conversationId: number,
  ): Promise<AssistantMessageView[]> {
    await this.ownConversation(scope, conversationId);
    const rows = await this.prisma.aiMessage.findMany({
      where: { conversationId },
      orderBy: { id: 'asc' },
      take: 500,
    });
    return rows.map(toMessageView);
  }

  private async ownConversation(
    scope: BookScope,
    id: number,
  ): Promise<AiConversation> {
    const c = await this.prisma.aiConversation.findFirst({
      where: { id, ...scopeWhere(scope) },
    });
    if (!c) throw new NotFoundException('Conversation not found');
    return c;
  }

  // ---- one answer, any channel ------------------------------------------------------

  /**
   * Stores the customer's message, answers it (tools on the conversation's book), stores the
   * answer. Never throws for an AI failure: the customer gets an apology instead.
   */
  async respond(
    conversation: AiConversation,
    text: string,
    opts: { attachment?: unknown; attachmentIds?: number[] } = {},
  ): Promise<ChatResult> {
    const scope: BookScope = {
      customerId: conversation.customerId,
      companyId: conversation.companyId,
    };
    const channel = conversation.channel as Channel;
    const history = await this.prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { id: 'desc' },
      take: HISTORY,
    });
    const message = await this.save(conversation, 'USER', text, {
      attachmentIds: opts.attachmentIds,
    });

    let answer: {
      text: string;
      actions: AgentAction[];
      warning: string | null;
    };
    if (await this.overLimit(scope.customerId)) {
      answer = {
        text: "You've reached today's limit for the assistant. It will answer again tomorrow.",
        actions: [],
        warning: null,
      };
    } else {
      answer = await this.run(
        scope,
        channel,
        message.id,
        text,
        history.reverse(),
        opts.attachment,
      );
    }
    const reply = await this.save(conversation, 'ASSISTANT', answer.text, {
      actions: answer.actions,
      warning: answer.warning,
    });
    return {
      conversationId: conversation.id,
      message: toMessageView(message),
      reply: toMessageView(reply),
    };
  }

  /** The tool loop. */
  private async run(
    scope: BookScope,
    channel: Channel,
    messageId: number,
    text: string,
    history: AiMessage[],
    attachment?: unknown,
  ): Promise<{ text: string; actions: AgentAction[]; warning: string | null }> {
    const actions: AgentAction[] = [];
    let warning: string | null = null;
    try {
      const messages: AgentMessage[] = [
        {
          role: 'system',
          content: systemPrompt({
            channel,
            today: new Date().toISOString().slice(0, 10),
            bookLabel: await this.bookLabel(scope),
            rules: await this.rules.promptBlock(scope),
            attachment,
          }),
        },
        ...history.map(
          (m): AgentMessage =>
            m.role === 'USER'
              ? { role: 'user', content: m.text }
              : { role: 'assistant', content: historyText(m) },
        ),
        { role: 'user', content: text },
      ];
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const last = round === MAX_TOOL_ROUNDS;
        const reply = await this.openai.chatMessages({
          model: this.model(),
          messages,
          tools: last ? undefined : ASSISTANT_TOOLS,
          maxTokens: 1200,
          timeoutMs: 90_000,
        });
        if (!reply.toolCalls.length || last) {
          return {
            text:
              reply.content?.trim() ||
              (actions.length ? 'Done.' : FAILED_REPLY),
            actions,
            warning,
          };
        }
        messages.push({
          role: 'assistant',
          content: reply.content,
          toolCalls: reply.toolCalls,
        });
        for (const call of reply.toolCalls) {
          const outcome = await this.tools.run(call.name, call.arguments, {
            scope,
            messageId,
          });
          if (outcome.action) actions.push(outcome.action);
          if (outcome.warning) warning = outcome.warning;
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: outcome.content,
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        `assistant customer ${scope.customerId} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    return { text: FAILED_REPLY, actions, warning };
  }

  private async overLimit(customerId: number): Promise<boolean> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const count = await this.prisma.aiMessage.count({
      where: { customerId, role: 'USER', createdAt: { gte: since } },
    });
    return count > this.dailyLimit();
  }

  private async bookLabel(scope: BookScope): Promise<string> {
    if (scope.companyId === null) return 'their personal / general books';
    const company = await this.prisma.company.findFirst({
      where: { id: scope.companyId },
      select: { businessName: true },
    });
    return `the books of their business "${company?.businessName ?? 'this business'}"`;
  }

  async save(
    conversation: AiConversation,
    role: 'USER' | 'ASSISTANT',
    text: string,
    extra: {
      actions?: AgentAction[];
      warning?: string | null;
      attachmentIds?: number[];
    } = {},
  ): Promise<AiMessage> {
    const [row] = await this.prisma.$transaction([
      this.prisma.aiMessage.create({
        data: {
          conversationId: conversation.id,
          customerId: conversation.customerId,
          companyId: conversation.companyId,
          channel: conversation.channel,
          role,
          text: text.slice(0, 20_000),
          ...(extra.actions?.length && {
            actions: extra.actions as unknown as Prisma.InputJsonValue,
          }),
          warning: extra.warning ?? null,
          ...(extra.attachmentIds?.length && {
            attachmentIds:
              extra.attachmentIds as unknown as Prisma.InputJsonValue,
          }),
        },
      }),
      this.prisma.aiConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return row;
  }
}
