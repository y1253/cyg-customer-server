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
    const [found, referenced] = await Promise.all([
      this.prisma.aiMessage.findMany({
        where: { ...book, ...older, channel },
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          role: true,
          text: true,
          warning: true,
          attachmentIds: true,
          createdAt: true,
        },
      }),
      source ? this.referencedIds(scope, channel) : Promise.resolve([]),
    ]);
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
      }),
      limit,
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
    const [messages, files] = await Promise.all([
      this.prisma.aiMessage.count({ where: { ...book, channel } }),
      source
        ? this.prisma.transactionAttachment.count({
            where: { ...book, deletedAt: null, source },
          })
        : Promise.resolve(0),
    ]);
    return messages + files;
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
