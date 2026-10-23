import { Injectable, Logger } from '@nestjs/common';
import type { AiConversation, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CHANNEL_LABEL,
  OTHER_CHANNELS,
  otherChannelsBlock,
  searchHit,
  whenLabel,
  type HistoryRow,
} from './history.util';

export interface CommunicationsQuery {
  channel?: string | null;
  query?: string | null;
  /** YYYY-MM-DD, inclusive. */
  from?: string | null;
  to?: string | null;
  limit?: number | null;
}

const CHANNELS = Object.keys(CHANNEL_LABEL);

/**
 * step12b: the assistant's memory across channels — everything the customer and the AI
 * said on the website, by text, WhatsApp, email and on the phone (`AiMessage`, any book of
 * THIS customer), with the files each message carried. Two uses: the short automatic block
 * in every prompt (`otherChannels`) and the `search_communications` tool (`search`).
 * Reads only; a failure is no memory, never a failed answer.
 */
@Injectable()
export class CommunicationsHistory {
  private readonly logger = new Logger(CommunicationsHistory.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The prompt block for this conversation: the other conversations' recent messages. */
  async otherChannels(conversation: AiConversation): Promise<string | null> {
    try {
      const since = new Date(Date.now() - OTHER_CHANNELS.hours * 3600_000);
      const rows = await this.rows(
        {
          customerId: conversation.customerId,
          conversationId: { not: conversation.id },
          createdAt: { gte: since },
          // An "Ask AI" thread about one file is not a channel the customer talks on.
          conversation: { attachmentId: null },
        },
        OTHER_CHANNELS.maxRows,
      );
      if (!rows.length) return null;
      return otherChannelsBlock(rows, {
        now: new Date(),
        currentBookId: conversation.bookId,
        bookName: await this.bookNames(conversation.customerId),
      });
    } catch (err) {
      this.logger.warn(
        `other channels not loaded: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** The last turns of one conversation as plain lines (a phone call's own memory). */
  async recentTurns(
    conversationId: number,
    take: number,
  ): Promise<string | null> {
    try {
      const rows = await this.prisma.aiMessage.findMany({
        where: { conversationId },
        orderBy: { id: 'desc' },
        take,
        select: { role: true, text: true, createdAt: true },
      });
      if (!rows.length) return null;
      return rows
        .reverse()
        .map(
          (r) =>
            `[${whenLabel(r.createdAt)} · ${r.role === 'USER' ? 'caller' : 'you'}] ${r.text.replace(/\s+/g, ' ').slice(0, 300)}`,
        )
        .join('\n');
    } catch {
      return null;
    }
  }

  /** `search_communications`: newest first, at most 30, plus the calls when asked. */
  async search(
    customerId: number,
    q: CommunicationsQuery,
  ): Promise<Record<string, unknown>> {
    const channel = q.channel?.toUpperCase() ?? null;
    if (channel && !CHANNELS.includes(channel)) {
      throw new Error(`channel must be one of ${CHANNELS.join(', ')}`);
    }
    const take = Math.min(Math.max(Math.trunc(q.limit ?? 15), 1), 30);
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.from) createdAt.gte = new Date(`${q.from}T00:00:00Z`);
    if (q.to)
      createdAt.lt = new Date(
        new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000,
      );
    const words = (q.query ?? '').trim();
    const rows = await this.rows(
      {
        customerId,
        ...(channel ? { channel } : {}),
        ...(createdAt.gte || createdAt.lt ? { createdAt } : {}),
        ...(words ? { text: { contains: words } } : {}),
      },
      take,
    );
    const bookName = await this.bookNames(customerId);
    const out: Record<string, unknown> = {
      messages: rows.map((r) => searchHit(r, bookName)),
    };
    if (!channel || channel === 'VOICE') {
      const calls = await this.prisma.aiCall.findMany({
        where: {
          customerId,
          ...(createdAt.gte || createdAt.lt ? { startedAt: createdAt } : {}),
        },
        orderBy: { id: 'desc' },
        take: 10,
        select: {
          direction: true,
          purpose: true,
          status: true,
          startedAt: true,
          durationSec: true,
        },
      });
      out.calls = calls.map((c) => ({
        when: whenLabel(c.startedAt),
        at: c.startedAt.toISOString(),
        direction:
          c.direction === 'OUTBOUND' ? 'we called them' : 'they called',
        purpose: c.purpose,
        status: c.status,
        minutes: c.durationSec ? Math.round(c.durationSec / 6) / 10 : null,
      }));
    }
    if (!rows.length) {
      out.note = words
        ? 'Nothing matched those words — try fewer or other words, or no query with a channel / dates.'
        : 'No messages in that range.';
    }
    return out;
  }

  /** Messages with their files (SENT / ACTION links; a deleted file is marked removed). */
  private async rows(
    where: Prisma.AiMessageWhereInput,
    take: number,
  ): Promise<HistoryRow[]> {
    const messages = await this.prisma.aiMessage.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
      select: {
        id: true,
        channel: true,
        role: true,
        text: true,
        createdAt: true,
        bookId: true,
        actions: true,
        attachmentLinks: { select: { attachmentId: true } },
      },
    });
    const ids = [
      ...new Set(
        messages.flatMap((m) => m.attachmentLinks.map((l) => l.attachmentId)),
      ),
    ];
    const files = ids.length
      ? await this.prisma.transactionAttachment.findMany({
          where: { id: { in: ids } },
          select: { id: true, filename: true, deletedAt: true },
        })
      : [];
    const byId = new Map(files.map((f) => [f.id, f]));
    return messages.map((m) => ({
      id: m.id,
      channel: m.channel,
      role: m.role,
      text: m.text,
      createdAt: m.createdAt,
      bookId: m.bookId,
      actions: m.actions,
      files: m.attachmentLinks.map((l) => {
        const f = byId.get(l.attachmentId);
        return {
          attachmentId: l.attachmentId,
          filename: f?.filename ?? 'file',
          removed: !f || f.deletedAt !== null,
        };
      }),
    }));
  }

  /** The customer's books (step12c: `Book` rows) by id → name. */
  private async bookNames(customerId: number): Promise<(id: number) => string> {
    const books = await this.prisma.book.findMany({
      where: { customerId },
      select: { id: true, name: true },
    });
    const names = new Map(books.map((b) => [b.id, b.name]));
    return (id) => names.get(id) ?? 'a deleted company';
  }
}
