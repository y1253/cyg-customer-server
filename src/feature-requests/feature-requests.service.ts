import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { FeatureRequest } from '@prisma/client';
import { answerHtml } from '../mail/answer-html';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulesService } from '../schedules/schedules.service';
import { doneTarget, featureDoneText } from './feature-requests.store';

export interface FeatureRequestView {
  id: number;
  summary: string;
  request: string;
  status: string;
  staffNote: string | null;
  channel: string;
  book: string | null;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
}

const BATCH = 20;

/**
 * step12e: the customer's "My requests" list, and the message that tells them a request
 * was built. Staff mark it DONE in the internal app; this server's cron sends the message
 * (the internal API has no customer messaging), once — `notifiedAt` is claimed first.
 */
@Injectable()
export class FeatureRequestsService {
  private readonly logger = new Logger(FeatureRequestsService.name);
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: CustomerMessenger,
    private readonly schedules: SchedulesService,
  ) {}

  async listForCustomer(customerId: number): Promise<FeatureRequestView[]> {
    const rows = await this.prisma.featureRequest.findMany({
      where: { customerId },
      orderBy: { id: 'desc' },
      take: 200,
    });
    const bookIds = [
      ...new Set(
        rows.map((r) => r.bookId).filter((id): id is number => id !== null),
      ),
    ];
    const books = bookIds.length
      ? await this.prisma.book.findMany({
          where: { id: { in: bookIds }, customerId },
          select: { id: true, name: true },
        })
      : [];
    const bookName = new Map(books.map((b) => [b.id, b.name]));
    return rows.map((r) => ({
      id: r.id,
      summary: r.summary,
      request: r.request,
      status: r.status,
      staffNote: r.staffNote,
      channel: r.channel,
      book: r.bookId !== null ? (bookName.get(r.bookId) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      doneAt: r.doneAt?.toISOString() ?? null,
    }));
  }

  // ---- the "it's available now" message ----------------------------------------------

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.prisma.featureRequest.findMany({
        where: { status: 'DONE', notifiedAt: null, notifyError: null },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      for (const r of due) {
        // Claimed first, so two ticks (or a restart mid-send) never message twice.
        const claimed = await this.prisma.featureRequest.updateMany({
          where: { id: r.id, status: 'DONE', notifiedAt: null },
          data: { notifiedAt: new Date() },
        });
        if (!claimed.count) continue;
        const error = await this.notify(r).catch((err: unknown) =>
          err instanceof Error ? err.message : String(err),
        );
        if (error) {
          this.logger.warn(`feature request #${r.id} not sent: ${error}`);
          await this.prisma.featureRequest.update({
            where: { id: r.id },
            data: { notifyError: error.slice(0, 512) },
          });
        } else {
          this.logger.log(`feature request #${r.id}: customer told it is done`);
        }
      }
    } catch (err) {
      this.logger.error(
        `feature request tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  /** null = sent, else why not. */
  private async notify(r: FeatureRequest): Promise<string | null> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: r.customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) return 'The customer account no longer exists.';
    const conversation = r.conversationId
      ? await this.prisma.aiConversation.findUnique({
          where: { id: r.conversationId },
          select: { channel: true, peer: true },
        })
      : null;
    const target = doneTarget(
      {
        channel: conversation?.channel ?? 'BOT',
        peer: conversation?.peer ?? null,
      },
      this.messenger.smsConfigured,
      await this.schedules.delivery(r.customerId, true),
    );
    if (!target) return 'No email address or phone number to send to.';
    const text = featureDoneText(r.summary, r.staffNote);
    if (target.channel === 'SMS') {
      const outcome = await this.messenger.send({
        channel: 'SMS',
        to: target.to,
        body: text,
        meta: {
          customerId: r.customerId,
          bookId: r.bookId,
          companyId: r.companyId,
          purpose: 'FEATURE_DONE',
        },
      });
      if (outcome !== 'sent') return `The text was not sent (${outcome}).`;
      // Saved in that phone's chat, so a reply has context.
      if (r.bookId !== null) {
        await this.schedules.logText(
          {
            customerId: r.customerId,
            bookId: r.bookId,
            companyId: r.companyId,
          },
          target.to,
          text,
        );
      }
      return null;
    }
    return this.schedules.email(target.to, {
      subject: 'What you asked for is now available',
      text,
      html: answerHtml(text),
      attachments: [],
    });
  }
}
