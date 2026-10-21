import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiConversation, AiMessage, Prisma } from '@prisma/client';
import { OpenAiClient, type AgentMessage } from '../ai/openai.client';
import { AttachmentProcessorService } from '../bookkeeping/attachment-processor.service';
import {
  AttachmentsService,
  type AttachmentView,
} from '../bookkeeping/attachments.service';
import { scopeWhere, type BookScope } from '../bookkeeping/scope';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantTools, toolsFor, type AgentAction } from './assistant-tools';
import { systemPrompt, type Channel } from './assistant-prompt';
import { RulesService } from './rules.service';

/** A file a message carried or is about (step11b) — kept even after the file is deleted. */
export interface MessageFileView {
  id: number;
  filename: string;
  /** SENT = came with the message, ABOUT = the chat is about it, ACTION = the AI changed it. */
  role: string;
  /** False = deleted since; the conversation still shows it. */
  live: boolean;
}

/** What the website (and the internal staff log) shows for one message. */
export interface AssistantMessageView {
  id: number;
  role: 'USER' | 'ASSISTANT';
  channel: Channel;
  text: string;
  warning: string | null;
  actions: AgentAction[] | null;
  createdAt: string;
  /** step11b: the files this message is linked to. */
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

/** Tool rounds per answer — after that the model must answer with what it has. */
export const MAX_TOOL_ROUNDS = 6;
/** Earlier messages the model sees. */
export const HISTORY = 20;
export const FAILED_REPLY =
  "Sorry — I couldn't answer that right now. Please try again in a minute.";
/** How long a web chat waits for the files it carries to be read before answering. */
export const CHAT_READ_WAIT_MS = 75_000;

/**
 * step11b: what the model is told about a file the customer just sent — what it is, what
 * was read, where it went. Small on purpose: the model can `get_attachment` for more.
 */
export function fileContext(a: AttachmentView) {
  return {
    id: a.id,
    filename: a.filename,
    type: a.reading?.documentType ?? a.kind,
    status: a.status,
    whatItIs: a.reading?.summary ?? null,
    total: a.total,
    date: a.reading?.date ?? null,
    payee: a.reading?.payee ?? a.reading?.vendor ?? null,
    filedTo: a.transaction
      ? {
          id: a.transaction.id,
          name: a.transaction.name ?? a.transaction.description,
          amount: a.transaction.amount,
          date: a.transaction.date,
        }
      : null,
    note: a.matchNote ?? a.error,
    transcript: a.reading?.transcript?.slice(0, 500) ?? null,
  };
}

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
    private readonly processor: AttachmentProcessorService,
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

  /**
   * A website message: continues `conversationId` (of this book) or starts a new chat.
   * step11b: it may carry files the customer just uploaded (`attachmentIds`, this book's,
   * via the normal upload); the answer waits for them to be read, so it can say what each is.
   */
  async chat(
    scope: BookScope,
    text: string,
    conversationId?: number,
    attachmentIds: number[] = [],
  ): Promise<ChatResult> {
    this.assertEnabled();
    const ids = [...new Set(attachmentIds)].slice(0, 10);
    for (const id of ids) await this.attachments.get(scope, id); // 404 when not this book's
    const words = text.trim() || (ids.length ? this.fileLabel(ids.length) : '');
    if (!words) throw new BadRequestException('Write a message or add a file');
    const conversation = conversationId
      ? await this.ownConversation(scope, conversationId)
      : await this.prisma.aiConversation.create({
          data: {
            ...scopeWhere(scope),
            channel: 'BOT',
            title: words.slice(0, 60),
          },
        });
    if (!ids.length) return this.respond(conversation, words);
    // Added in the chat: listed in the website chat, not under Uploads (Communication tab).
    await this.prisma.transactionAttachment.updateMany({
      where: { id: { in: ids }, ...scopeWhere(scope), source: 'UPLOAD' },
      data: { source: 'CHAT' },
    });
    await this.processor.waitUntilRead(ids, CHAT_READ_WAIT_MS);
    const all = await this.processor.family(ids);
    return this.respond(conversation, words, {
      attachmentIds: all,
      files: await this.filesContext(scope, all),
    });
  }

  /** "[sent a file]" — what a message with files and no words says. */
  fileLabel(n: number): string {
    return n === 1 ? '[sent a file]' : `[sent ${n} files]`;
  }

  /** step11b: what the model is told about files that came with a message (see `fileContext`). */
  async filesContext(scope: BookScope, ids: number[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const id of ids) {
      try {
        out.push(fileContext(await this.attachments.get(scope, id)));
      } catch {
        // deleted or moved since: nothing to say about it
      }
    }
    return out;
  }

  /**
   * step11b: every message linked to one attachment, on any channel — the files it came with,
   * its "Ask AI" chat, and what the assistant did to it — with the answer that followed each
   * customer message. Works after the file is deleted (the link has no foreign key).
   */
  async attachmentMessages(
    scope: BookScope,
    attachmentId: number,
  ): Promise<AssistantMessageView[]> {
    const links = await this.prisma.aiMessageAttachment.findMany({
      where: { ...scopeWhere(scope), attachmentId },
      select: { messageId: true },
    });
    if (!links.length) return [];
    const linked = await this.prisma.aiMessage.findMany({
      where: { id: { in: links.map((l) => l.messageId) } },
      select: { id: true, conversationId: true, role: true },
    });
    // A customer's message brings its answer along (the next assistant message).
    const ids = new Set(linked.map((m) => m.id));
    for (const m of linked.filter((x) => x.role === 'USER')) {
      const next = await this.prisma.aiMessage.findFirst({
        where: { conversationId: m.conversationId, id: { gt: m.id } },
        orderBy: { id: 'asc' },
        select: { id: true, role: true },
      });
      if (next?.role === 'ASSISTANT') ids.add(next.id);
    }
    const rows = await this.prisma.aiMessage.findMany({
      where: { id: { in: [...ids] }, ...scopeWhere(scope) },
      orderBy: { id: 'asc' },
      take: 200,
    });
    return this.withFiles(rows);
  }

  /** Message views with the files each one is linked to. */
  async withFiles(rows: AiMessage[]): Promise<AssistantMessageView[]> {
    if (!rows.length) return [];
    const links = await this.prisma.aiMessageAttachment.findMany({
      where: { messageId: { in: rows.map((m) => m.id) } },
      select: { messageId: true, attachmentId: true, role: true },
      orderBy: { id: 'asc' },
    });
    const files = links.length
      ? await this.prisma.transactionAttachment.findMany({
          where: { id: { in: [...new Set(links.map((l) => l.attachmentId))] } },
          select: { id: true, filename: true, deletedAt: true },
        })
      : [];
    const byId = new Map(files.map((f) => [f.id, f]));
    return rows.map((m) => {
      const mine = links.filter((l) => l.messageId === m.id);
      return {
        ...toMessageView(m),
        files: mine.map((l) => {
          const f = byId.get(l.attachmentId);
          return {
            id: l.attachmentId,
            filename: f?.filename ?? 'File',
            role: l.role,
            live: !!f && !f.deletedAt,
          };
        }),
      };
    });
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
    return this.withFiles(rows);
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
    opts: {
      attachment?: unknown;
      attachmentIds?: number[];
      /** step11b: the files that came with this message, already read (`fileContext`). */
      files?: unknown[];
    } = {},
  ): Promise<ChatResult> {
    const scope: BookScope = {
      customerId: conversation.customerId,
      companyId: conversation.companyId,
    };
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
      touched: number[];
    };
    if (await this.overLimit(scope.customerId)) {
      answer = {
        text: "You've reached today's limit for the assistant. It will answer again tomorrow.",
        actions: [],
        warning: null,
        touched: [],
      };
    } else {
      answer = await this.run(
        scope,
        conversation,
        message.id,
        text,
        history.reverse(),
        opts.attachment,
        opts.files,
      );
    }
    // A switch_book in this answer moved the conversation: the reply belongs to the new book.
    const current =
      (await this.prisma.aiConversation.findUnique({
        where: { id: conversation.id },
      })) ?? conversation;
    const reply = await this.save(current, 'ASSISTANT', answer.text, {
      actions: answer.actions,
      warning: answer.warning,
      actedOn: answer.touched,
    });
    const [m, r] = await this.withFiles([message, reply]);
    return { conversationId: conversation.id, message: m, reply: r };
  }

  /** The tool loop. */
  private async run(
    scope: BookScope,
    conversation: AiConversation,
    messageId: number,
    text: string,
    history: AiMessage[],
    attachment?: unknown,
    files?: unknown[],
  ): Promise<{
    text: string;
    actions: AgentAction[];
    warning: string | null;
    touched: number[];
  }> {
    const channel = conversation.channel as Channel;
    const actions: AgentAction[] = [];
    const touched: number[] = [];
    const tools = toolsFor(channel);
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
            preferredContact: await this.preferredContact(scope.customerId),
            attachment,
            files,
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
          tools: last ? undefined : tools,
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
            touched,
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
            conversation,
          });
          if (outcome.action) actions.push(outcome.action);
          if (outcome.warning) warning = outcome.warning;
          if (outcome.attachmentId) touched.push(outcome.attachmentId);
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
    return { text: FAILED_REPLY, actions, warning, touched };
  }

  private async overLimit(customerId: number): Promise<boolean> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const count = await this.prisma.aiMessage.count({
      where: { customerId, role: 'USER', createdAt: { gte: since } },
    });
    return count > this.dailyLimit();
  }

  /** How the customer likes to be reached (step12) — a hint only, so a failed read is no hint. */
  private async preferredContact(customerId: number): Promise<string | null> {
    try {
      const c = await this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { preferredContact: true },
      });
      return c?.preferredContact ?? null;
    } catch {
      return null;
    }
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
      /** step11b: attachments a tool changed for this answer (ACTION links). */
      actedOn?: number[];
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
    await this.link(row, conversation, extra.attachmentIds, extra.actedOn);
    return row;
  }

  /**
   * step11b: links a message to the attachments it is about (`AiMessageAttachment`) — SENT
   * (arrived with it), ABOUT (its conversation is an "Ask AI" chat about one file), ACTION
   * (a tool changed it). Never fails the message.
   */
  private async link(
    row: AiMessage,
    conversation: AiConversation,
    sent: number[] = [],
    acted: number[] = [],
  ): Promise<void> {
    const links = new Map<number, string>();
    for (const id of acted) if (id > 0) links.set(id, 'ACTION');
    if (conversation.attachmentId)
      links.set(conversation.attachmentId, 'ABOUT');
    for (const id of sent) if (id > 0) links.set(id, 'SENT');
    if (!links.size) return;
    try {
      await this.prisma.aiMessageAttachment.createMany({
        data: [...links].map(([attachmentId, role]) => ({
          messageId: row.id,
          attachmentId,
          customerId: row.customerId,
          companyId: row.companyId,
          role,
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      this.logger.warn(
        `message #${row.id}: attachment links not saved: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
