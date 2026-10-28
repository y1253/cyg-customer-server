import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firmReach } from '../messaging/reach';
import type { AiConversation, AiMessage, Prisma } from '@prisma/client';
import { withAiUsage } from '../ai/ai-usage.context';
import { OpenAiClient, type AgentMessage } from '../ai/openai.client';
import { AttachmentProcessorService } from '../bookkeeping/attachment-processor.service';
import {
  AttachmentsService,
  type AttachmentView,
} from '../bookkeeping/attachments.service';
import { scopeOf, scopeWhere, type BookScope } from '../bookkeeping/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssistantTools,
  READ_TOOLS,
  toolsFor,
  type AgentAction,
  type ToolContext,
} from './assistant-tools';
import { systemPrompt, type Channel } from './assistant-prompt';
import { CommunicationsHistory } from './communications-history.service';
import { InstructionsService } from './instructions.service';
import { fillLinks, type LinkBook } from './links.util';
import { RulesService } from './rules.service';
import { spokenMessage } from './voice-notes.util';
import { changeFeed } from './change-feed';

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
/** step12b: earlier turns of the same phone line a call starts with. */
export const VOICE_HISTORY = 10;
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
    // step12: a voice note's words are the customer's message itself (`spokenMessage`).
    ...(a.reading?.transcript ? { voiceNote: true } : {}),
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

export interface LoopResult {
  text: string;
  actions: AgentAction[];
  warning: string | null;
  touched: number[];
}

/**
 * step12: appended to the prompt of a scheduled run — nobody is there to answer a question,
 * and nothing may be changed.
 */
const SCHEDULED_NOTE =
  'This is a SCHEDULED message the customer asked for: the user message below is the ' +
  'task they set. Look the data up with your tools and write the message itself, ready to ' +
  'send — no questions, no "let me know", no greeting beyond one short line. You cannot ' +
  'change anything in this run. If there is nothing to report, say so in one line.';

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
    @Optional() private readonly instructions?: InstructionsService,
    /** step12b: what the customer said on their other channels (absent in old specs). */
    @Optional() private readonly history?: CommunicationsHistory,
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
    const typed = text.trim() || (ids.length ? this.fileLabel(ids.length) : '');
    if (!typed) throw new BadRequestException('Write a message or add a file');
    const conversation = conversationId
      ? await this.ownConversation(scope, conversationId)
      : await this.prisma.aiConversation.create({
          data: {
            ...scopeWhere(scope),
            channel: 'BOT',
            title: typed.slice(0, 60),
          },
        });
    if (!ids.length) return this.respond(conversation, typed);
    // Added in the chat: listed in the website chat, not under Uploads (Communication tab).
    await this.prisma.transactionAttachment.updateMany({
      where: { id: { in: ids }, ...scopeWhere(scope), source: 'UPLOAD' },
      data: { source: 'CHAT' },
    });
    await this.processor.waitUntilRead(ids, CHAT_READ_WAIT_MS);
    const all = await this.processor.family(ids);
    const { words, files } = await this.filesMessage(
      scope,
      text,
      all,
      ids.length,
    );
    return this.respond(conversation, words, { attachmentIds: all, files });
  }

  /** "[sent a file]" — what a message with files and no words says. */
  fileLabel(n: number): string {
    return n === 1 ? '[sent a file]' : `[sent ${n} files]`;
  }

  /**
   * step11b/12: the message and the file list the model gets for files that came with a
   * message (all already read). A voice note's words become the customer's message, and a
   * voice note with no payment in it is not a file at all (`spokenMessage`) — the WhatsApp
   * voice note asking for a report used to be answered "couldn't find where to attach it".
   * `attachmentIds` stays ALL the ids, so the recording is still linked to the message.
   */
  async filesMessage(
    scope: BookScope,
    text: string | null,
    ids: number[],
    /** How many files the customer SENT (siblings excluded) — for "[sent 2 files]". */
    sent = ids.length,
  ): Promise<{ words: string; files: unknown[] }> {
    const views: AttachmentView[] = [];
    for (const id of ids) {
      try {
        views.push(await this.attachments.get(scope, id));
      } catch {
        // deleted or moved since: nothing to say about it
      }
    }
    const spoken = spokenMessage(text, views);
    return {
      words: spoken.words || this.fileLabel(sent),
      files: spoken.files.map(fileContext),
    };
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
    const scope: BookScope = scopeOf(conversation);
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

  /** The tool loop (step12: its OpenAI calls are this customer's ASSISTANT cost). */
  private run(
    scope: BookScope,
    conversation: AiConversation,
    messageId: number,
    text: string,
    history: AiMessage[],
    attachment?: unknown,
    files?: unknown[],
  ): Promise<LoopResult> {
    return withAiUsage(
      {
        ...scope,
        feature: 'ASSISTANT',
      },
      () =>
        this.runChat(
          scope,
          conversation,
          messageId,
          text,
          history,
          attachment,
          files,
        ),
    );
  }

  private async runChat(
    scope: BookScope,
    conversation: AiConversation,
    messageId: number,
    text: string,
    history: AiMessage[],
    attachment?: unknown,
    files?: unknown[],
  ): Promise<LoopResult> {
    const channel = conversation.channel as Channel;
    const tools = toolsFor(channel);
    // step12: links issued in this answer — the model sees `[[link:N]]`, never the URL.
    const links: LinkBook = new Map();
    // What was done before an AI failure is still reported under the failed reply.
    const done: LoopResult = {
      text: '',
      actions: [],
      warning: null,
      touched: [],
    };
    try {
      const messages: AgentMessage[] = [
        {
          role: 'system',
          content: await this.promptFor(conversation, { attachment, files }),
        },
        ...history.map(
          (m): AgentMessage =>
            m.role === 'USER'
              ? { role: 'user', content: m.text }
              : { role: 'assistant', content: historyText(m) },
        ),
        { role: 'user', content: text },
      ];
      return await this.loop(
        messages,
        tools,
        { scope, messageId, conversation, links },
        done,
      );
    } catch (err) {
      this.logger.warn(
        `assistant customer ${scope.customerId} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    return { ...done, text: FAILED_REPLY };
  }

  /**
   * step12h: one more answer on a conversation with no new customer message — a note from
   * our side (the strong AI's result once the call it was asked on has ended). The agent
   * works with the tools of `channel` and its answer is saved with what it did; the caller
   * sends it. Null when the AI failed (nothing to send).
   */
  followUp(
    conversation: AiConversation,
    note: string,
    channel: 'SMS' | 'EMAIL',
  ): Promise<LoopResult | null> {
    const scope: BookScope = scopeOf(conversation);
    return withAiUsage({ ...scope, feature: 'ASSISTANT' }, async () => {
      try {
        const history = await this.prisma.aiMessage.findMany({
          where: { conversationId: conversation.id },
          orderBy: { id: 'desc' },
          take: HISTORY,
        });
        const messages: AgentMessage[] = [
          { role: 'system', content: await this.promptFor(conversation) },
          ...history
            .reverse()
            .map(
              (m): AgentMessage =>
                m.role === 'USER'
                  ? { role: 'user', content: m.text }
                  : { role: 'assistant', content: historyText(m) },
            ),
          {
            role: 'user',
            content: `[From CYG Finance, not the customer: ${note} Your answer is sent to them as a ${channel === 'SMS' ? 'text message' : 'email'} — plain text, short, no phone-call style.]`,
          },
        ];
        const lastUser = history.find((m) => m.role === 'USER');
        const out = await this.loop(messages, toolsFor(channel), {
          scope,
          messageId: lastUser?.id ?? null,
          conversation,
          links: new Map(),
        });
        if (out.text === FAILED_REPLY) return null;
        const current =
          (await this.prisma.aiConversation.findUnique({
            where: { id: conversation.id },
          })) ?? conversation;
        await this.save(current, 'ASSISTANT', out.text, {
          actions: out.actions,
          warning: out.warning,
          actedOn: out.touched,
        });
        return out;
      } catch (err) {
        this.logger.warn(
          `follow-up for conversation ${conversation.id} failed: ${err instanceof Error ? err.message : err}`,
        );
        return null;
      }
    });
  }

  /** Model ↔ tools until the model answers (or `MAX_TOOL_ROUNDS`). Throws on an AI outage. */
  private async loop(
    messages: AgentMessage[],
    tools: ReturnType<typeof toolsFor>,
    ctx: ToolContext & { links: LinkBook },
    acc: LoopResult = { text: '', actions: [], warning: null, touched: [] },
  ): Promise<LoopResult> {
    const { actions, touched } = acc;
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
        const said = reply.content?.trim();
        return {
          text: said
            ? fillLinks(said, ctx.links)
            : actions.length
              ? 'Done.'
              : FAILED_REPLY,
          actions,
          warning: acc.warning,
          touched,
        };
      }
      messages.push({
        role: 'assistant',
        content: reply.content,
        toolCalls: reply.toolCalls,
      });
      for (const call of reply.toolCalls) {
        const outcome = await this.tools.run(call.name, call.arguments, ctx);
        if (outcome.action) actions.push(outcome.action);
        if (outcome.warning) acc.warning = outcome.warning;
        if (outcome.attachmentId) touched.push(outcome.attachmentId);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: outcome.content,
        });
      }
    }
    return { ...acc, text: FAILED_REPLY };
  }

  /**
   * step12: one run of a schedule the customer asked for (`AiSchedule.task`) — the same
   * agent, READ tools only, no conversation saved. The answer is the message that goes out
   * by `channel`; null when the AI failed (nothing is sent). Its cost is SCHEDULE.
   */
  runTask(
    scope: BookScope,
    task: string,
    /** step12b: VOICE = written to be said on a call (an AI schedule with channel CALL). */
    channel: 'SMS' | 'EMAIL' | 'VOICE',
  ): Promise<string | null> {
    return withAiUsage(
      {
        ...scope,
        feature: 'SCHEDULE',
      },
      async () => {
        try {
          const prompt = systemPrompt(
            {
              channel,
              today: new Date().toISOString().slice(0, 10),
              bookLabel: await this.bookLabel(scope),
              rules: await this.rules.promptBlock(scope),
              preferredContact: await this.preferredContact(scope.customerId),
              reach: await firmReach(this.prisma, this.config).catch(
                () => null,
              ),
            },
            await this.instructions?.assistant(),
          );
          const messages: AgentMessage[] = [
            { role: 'system', content: `${prompt}\n\n${SCHEDULED_NOTE}` },
            { role: 'user', content: task },
          ];
          const out = await this.loop(messages, READ_TOOLS, {
            scope,
            messageId: null,
            links: new Map(),
          });
          return out.text === FAILED_REPLY ? null : out.text;
        } catch (err) {
          this.logger.warn(
            `scheduled task for customer ${scope.customerId} failed: ${err instanceof Error ? err.message : err}`,
          );
          return null;
        }
      },
    );
  }

  /**
   * The agent's whole system prompt for this conversation — the SAME text the chat uses
   * (rules, book, preferred contact, channel style). step12: the phone bridge hands it to
   * OpenAI Realtime as `instructions`, so a call is the same agent as a text.
   */
  async promptFor(
    conversation: AiConversation,
    extra: { attachment?: unknown; files?: unknown[]; note?: string } = {},
  ): Promise<string> {
    const scope: BookScope = scopeOf(conversation);
    const prompt = systemPrompt(
      {
        channel: conversation.channel as Channel,
        today: new Date().toISOString().slice(0, 10),
        bookLabel: await this.bookLabel(scope),
        rules: await this.rules.promptBlock(scope),
        preferredContact: await this.preferredContact(scope.customerId),
        reach: await firmReach(this.prisma, this.config).catch(() => null),
        nameUnknown: await this.nameUnknown(scope.customerId),
        attachment: extra.attachment,
        files: extra.files,
      },
      // step12: the blocks as the strong AI / staff last left them (`AiInstruction`).
      await this.instructions?.assistant(),
    );
    const parts = [prompt];
    // step12b: one agent on every channel — it sees what was said on the others.
    const elsewhere = await this.history?.otherChannels(conversation);
    if (elsewhere) parts.push(elsewhere);
    // A phone call carries no chat history of its own: give it this line's earlier calls.
    if (conversation.channel === 'VOICE') {
      const earlier = await this.history?.recentTurns(
        conversation.id,
        VOICE_HISTORY,
      );
      if (earlier) {
        parts.push(
          `EARLIER CALLS ON THIS PHONE LINE (oldest first):\n${earlier}`,
        );
      }
    }
    if (extra.note) parts.push(extra.note);
    return parts.join('\n\n');
  }

  /** Today's customer messages are over the daily limit (step12: checked before a call). */
  isOverLimit(customerId: number): Promise<boolean> {
    return this.overLimit(customerId);
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
  /** step12c: an account opened by text has no name until the AI asks. */
  private async nameUnknown(customerId: number): Promise<boolean> {
    const c = await this.prisma.customer
      .findUnique({ where: { id: customerId }, select: { name: true } })
      .catch(() => null);
    return !!c && !c.name.trim();
  }

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

  /** step12c: the book (bookkeeping company) this chat works on, by name. */
  private async bookLabel(scope: BookScope): Promise<string> {
    const book = await this.prisma.book.findUnique({
      where: { id: scope.bookId },
      select: { name: true },
    });
    const name = book?.name ?? 'this company';
    return scope.companyId === null
      ? `the books of their company "${name}"`
      : `the books of their registered business "${name}"`;
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
          bookId: conversation.bookId,
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
    // step12h: the AI changed something (any channel) — an open page refreshes by itself.
    if (extra.actions?.some((a) => a.ok))
      changeFeed.bump(conversation.customerId);
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
          bookId: row.bookId,
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
