import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildTimeline,
  COMM_CHANNELS,
  FILE_SOURCE,
  idsOf,
  pageOf,
  previewOf,
  type AttachmentIn,
  type CommChannel,
  type CommItem,
} from './communications.util';
import { scopeWhere, type BookScope } from './scope';
import { toCallView } from '../voice/voice-calls.service';
import {
  TRANSCRIPT_GRACE_MS,
  callWindows,
  inCallWindow,
  type CallSpan,
} from '../voice/voice.util';

export interface ChannelSummary {
  channel: CommChannel;
  /** ISO time of the newest item; null = nothing yet. */
  lastAt: string | null;
  preview: string | null;
  count: number;
}

export interface CommPage {
  items: CommItem[];
  /** Pass as `before` for the next (older) page; null = that was the oldest. */
  nextBefore: string | null;
}

const ATTACHMENT_FIELDS = {
  id: true,
  filename: true,
  mimeType: true,
  status: true,
  message: true,
  createdAt: true,
  deletedAt: true,
} as const;

/** A file the chat still shows after it was deleted (or refiled as a statement). */
const shown = <T extends { status: string; deletedAt: Date | null }>(a: T) =>
  a.deletedAt ? { ...a, status: 'REMOVED' } : a;

/**
 * The Communication tab (step12): one book's history per channel, read from what is
 * already stored — the assistant's log (`AiMessage`, every channel), the files that came
 * by text / WhatsApp / email (`TransactionAttachment.source`) and what was uploaded on the
 * site (attachments + statements). Nothing new is written for it.
 */
@Injectable()
export class CommunicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async channels(scope: BookScope): Promise<ChannelSummary[]> {
    return Promise.all(
      COMM_CHANNELS.map(async (channel) => {
        const [count, newest] = await Promise.all([
          this.count(scope, channel),
          this.page(scope, channel, null, 1),
        ]);
        return {
          channel,
          count,
          lastAt: newest.items[0]?.at ?? null,
          preview: previewOf(newest.items[0]),
        };
      }),
    );
  }

  /** Newest first, `limit` items older than `before`. */
  async page(
    scope: BookScope,
    channel: CommChannel,
    before: Date | null,
    limit = 50,
  ): Promise<CommPage> {
    const book = scopeWhere(scope);
    const older = before ? { createdAt: { lt: before } } : {};
    const take = limit + 1;

    if (channel === 'UPLOADS') {
      const [loose, statements] = await Promise.all([
        this.prisma.transactionAttachment.findMany({
          where: { ...book, ...older, deletedAt: null, source: 'UPLOAD' },
          orderBy: { createdAt: 'desc' },
          take,
          select: ATTACHMENT_FIELDS,
        }),
        this.prisma.bankStatement.findMany({
          where: { ...book, ...older, deletedAt: null, source: 'UPLOAD' },
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, filename: true, status: true, createdAt: true },
        }),
      ]);
      return pageOf(
        buildTimeline({ messages: [], files: new Map(), loose, statements }),
        limit,
      );
    }

    const source = FILE_SOURCE[channel];
    const [fetched, referenced] = await Promise.all([
      this.prisma.aiMessage.findMany({
        where: { ...book, ...older, channel },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          conversationId: true,
          role: true,
          text: true,
          warning: true,
          attachmentIds: true,
          createdAt: true,
        },
      }),
      source ? this.referencedIds(scope, channel) : Promise.resolve([]),
    ]);
    // step12g: a call's transcript lines live in its card, not as bubbles around it.
    let found = fetched;
    let cutoff: string | null = null;
    if (channel === 'VOICE' && fetched.length) {
      const windows = callWindows(await this.spansAround(fetched));
      found = fetched.filter(
        (m) => !inCallWindow(windows, m.conversationId, m.createdAt),
      );
      if (fetched.length === take && found.length < fetched.length) {
        cutoff = fetched[fetched.length - 1].createdAt.toISOString();
      }
    }
    // step11b: every file a message is LINKED to (sent with it, the "Ask AI" file it is
    // about, one the assistant changed) — `AiMessageAttachment`, plus the old JSON column.
    const links = found.length
      ? await this.prisma.aiMessageAttachment.findMany({
          where: { messageId: { in: found.map((m) => m.id) } },
          select: { messageId: true, attachmentId: true },
          orderBy: { id: 'asc' },
        })
      : [];
    const messages = found.map((m) => ({
      ...m,
      attachmentIds: [
        ...new Set([
          ...idsOf(m.attachmentIds),
          ...links
            .filter((l) => l.messageId === m.id)
            .map((l) => l.attachmentId),
        ]),
      ],
    }));
    // step12: the phone calls themselves, between their transcript messages.
    const calls =
      channel === 'VOICE'
        ? (
            await this.prisma.aiCall.findMany({
              where: {
                ...book,
                ...(before ? { startedAt: { lt: before } } : {}),
              },
              orderBy: { startedAt: 'desc' },
              take,
              include: {
                contact: { select: { name: true } },
                customer: { select: { name: true } },
              },
            })
          ).map((c) => ({ ...toCallView(c), startedAt: c.startedAt, c }))
        : [];
    if (calls.length) {
      const windows = callWindows(calls.map((x) => x.c));
      await Promise.all(
        windows.map(async (w) => {
          const line = await this.prisma.aiMessage.findFirst({
            where: {
              conversationId: w.call.conversationId,
              channel: 'VOICE',
              createdAt: { gte: w.from, lt: w.to },
            },
            select: { id: true },
          });
          const view = calls.find((x) => x.c === w.call);
          if (view) view.hasTranscript = !!line;
        }),
      );
    }
    const [carried, loose] = await Promise.all([
      // A message keeps showing its files, deleted or not (it was sent / it was about them).
      this.prisma.transactionAttachment.findMany({
        where: {
          customerId: scope.customerId,
          id: { in: messages.flatMap((m) => m.attachmentIds) },
        },
        select: ATTACHMENT_FIELDS,
      }),
      source
        ? this.prisma.transactionAttachment.findMany({
            where: {
              ...book,
              ...older,
              deletedAt: null,
              source,
              ...(referenced.length && { id: { notIn: referenced } }),
            },
            orderBy: { createdAt: 'desc' },
            take,
            select: ATTACHMENT_FIELDS,
          })
        : Promise.resolve([] as AttachmentIn[]),
    ]);
    return pageOf(
      buildTimeline({
        messages,
        files: new Map(carried.map((a) => [a.id, shown(a)])),
        loose,
        statements: [],
        calls: calls.map(({ c: _row, ...view }) => view),
      }),
      limit,
      cutoff,
    );
  }

  private async count(scope: BookScope, channel: CommChannel): Promise<number> {
    const book = scopeWhere(scope);
    if (channel === 'UPLOADS') {
      const [a, s] = await Promise.all([
        this.prisma.transactionAttachment.count({
          where: { ...book, deletedAt: null, source: 'UPLOAD' },
        }),
        this.prisma.bankStatement.count({
          where: { ...book, deletedAt: null, source: 'UPLOAD' },
        }),
      ]);
      return a + s;
    }
    const source = FILE_SOURCE[channel];
    const [messages, files, calls] = await Promise.all([
      this.prisma.aiMessage.count({ where: { ...book, channel } }),
      source
        ? this.prisma.transactionAttachment.count({
            where: { ...book, deletedAt: null, source },
          })
        : Promise.resolve(0),
      channel === 'VOICE'
        ? this.prisma.aiCall.count({ where: book })
        : Promise.resolve(0),
    ]);
    const transcripts =
      channel === 'VOICE' ? await this.transcriptCount(scope) : 0;
    return messages - transcripts + files + calls;
  }

  /**
   * step12g: the calls whose transcript window can hold one of these VOICE messages (the
   * page's own calls and the ones on a neighbouring page alike).
   */
  private async spansAround(
    messages: Array<{ conversationId: number; createdAt: Date }>,
  ): Promise<CallSpan[]> {
    const times = messages.map((m) => m.createdAt.getTime());
    const oldest = new Date(Math.min(...times) - TRANSCRIPT_GRACE_MS);
    return this.prisma.aiCall.findMany({
      where: {
        conversationId: {
          in: [...new Set(messages.map((m) => m.conversationId))],
        },
        startedAt: { lte: new Date(Math.max(...times) + 5_000) },
        OR: [{ endedAt: null }, { endedAt: { gte: oldest } }],
      },
      select: { conversationId: true, startedAt: true, endedAt: true },
    });
  }

  /** step12g: the book's VOICE messages that are a call's transcript (not counted twice). */
  private async transcriptCount(scope: BookScope): Promise<number> {
    const calls = await this.prisma.aiCall.findMany({
      where: scopeWhere(scope),
      orderBy: { startedAt: 'desc' },
      take: 500,
      select: { conversationId: true, startedAt: true, endedAt: true },
    });
    if (!calls.length) return 0;
    return this.prisma.aiMessage.count({
      where: {
        ...scopeWhere(scope),
        channel: 'VOICE',
        OR: callWindows(calls).map((w) => ({
          conversationId: w.call.conversationId,
          createdAt: { gte: w.from, lt: w.to },
        })),
      },
    });
  }

  /** Every file a message of this channel already shows — so it is not listed twice. */
  private async referencedIds(
    scope: BookScope,
    channel: CommChannel,
  ): Promise<number[]> {
    const [rows, links] = await Promise.all([
      this.prisma.aiMessage.findMany({
        where: { ...scopeWhere(scope), channel, role: 'USER' },
        select: { attachmentIds: true },
      }),
      this.prisma.aiMessageAttachment.findMany({
        where: {
          ...scopeWhere(scope),
          role: 'SENT',
          message: { channel, role: 'USER' },
        },
        select: { attachmentId: true },
      }),
    ]);
    return [
      ...new Set([
        ...rows.flatMap((r) => idsOf(r.attachmentIds)),
        ...links.map((l) => l.attachmentId),
      ]),
    ];
  }
}
