import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { AiSchedule, AiScheduleRun } from '@prisma/client';
import { AssistantService } from '../assistant/assistant.service';
import type { BookScope } from '../bookkeeping/scope';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AiSchedulesStore,
  aiRuleOf,
  type AiScheduleChannel,
  type AiScheduleInput,
} from './ai-schedules.store';
import { nextRun, type Frequency } from './next-run.util';
import { SchedulesService, type ScheduleRunView } from './schedules.service';

export interface AiScheduleView {
  id: number;
  title: string;
  task: string;
  frequency: Frequency;
  weekday: number | null;
  monthDay: number | null;
  time: string;
  timezone: string;
  /** "Every day at 6:00 AM". */
  description: string;
  /** The channel the customer picked; null = their preferred contact. */
  channel: AiScheduleChannel | null;
  active: boolean;
  createdBy: 'AI' | 'CUSTOMER';
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  /** How it will actually go out right now. */
  delivery: { channel: AiScheduleChannel | null; to: string | null };
  runs: ScheduleRunView[];
}

const BATCH = 10;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The answer as a simple HTML email: line breaks kept, links clickable. */
function answerHtml(text: string): string {
  const body = escapeHtml(text).replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}">${url}</a>`,
  );
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${body}</div>`;
}

/**
 * step12: sends the schedules the customer asked the AI for (`AiSchedule`). Each time one
 * fires, the assistant answers its `task` with READ tools only (`AssistantService.runTask`,
 * cost filed as SCHEDULE) and the answer goes out by text or email — the channel the
 * customer asked for, else their preferred contact (a "Phone call" preference gets a text:
 * a free-form answer is not read out on a call). Delivery reuses the built-in schedules'
 * helpers (`SchedulesService`), so the email / text / fallback rules are the same.
 *
 * A minute cron claims due rows (conditional update on `nextRunAt`) before anything is
 * sent, so one tick never sends twice — the `SchedulesService.tick` pattern.
 */
@Injectable()
export class AiSchedulesService {
  private readonly logger = new Logger(AiSchedulesService.name);
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: AiSchedulesStore,
    private readonly schedules: SchedulesService,
    private readonly assistant: AssistantService,
    private readonly messenger: CustomerMessenger,
  ) {}

  // ---- the Schedules tab -------------------------------------------------------------

  async list(scope: BookScope): Promise<AiScheduleView[]> {
    const rows = await this.store.list(scope);
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async update(
    scope: BookScope,
    id: number,
    input: AiScheduleInput,
  ): Promise<AiScheduleView> {
    return this.view(await this.store.update(scope, id, input));
  }

  async remove(scope: BookScope, id: number): Promise<void> {
    await this.store.remove(scope, id);
  }

  /** "Send now": runs once at once; the schedule itself is unchanged. */
  async sendNow(scope: BookScope, id: number): Promise<AiScheduleView> {
    const row = await this.store.get(scope, id);
    await this.run(row, true);
    return this.view(await this.store.get(scope, id));
  }

  // ---- the cron ------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date();
      const due = await this.prisma.aiSchedule.findMany({
        where: { active: true, deletedAt: null, nextRunAt: { lte: now } },
        orderBy: { nextRunAt: 'asc' },
        take: BATCH,
      });
      for (const s of due) {
        const claimed = await this.prisma.aiSchedule.updateMany({
          where: { id: s.id, active: true, nextRunAt: s.nextRunAt },
          data: { nextRunAt: nextRun(aiRuleOf(s), now), lastRunAt: now },
        });
        if (!claimed.count) continue;
        await this.run(s, false).catch((err: unknown) =>
          this.logger.error(
            `ai schedule #${s.id} FAILED: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    } catch (err) {
      this.logger.error(
        `ai schedule tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  // ---- one send ------------------------------------------------------------------------

  private async run(s: AiSchedule, manual: boolean): Promise<AiScheduleRun> {
    const scope: BookScope = {
      customerId: s.customerId,
      companyId: s.companyId,
    };
    const record = (data: {
      channel: string;
      ok: boolean;
      text?: string | null;
      error?: string | null;
    }) =>
      this.prisma.aiScheduleRun.create({
        data: {
          scheduleId: s.id,
          manual,
          channel: data.channel,
          ok: data.ok,
          text: data.text?.slice(0, 20_000) ?? null,
          error: data.error?.slice(0, 512) ?? null,
        },
      });
    if (manual) {
      await this.prisma.aiSchedule.update({
        where: { id: s.id },
        data: { lastRunAt: new Date() },
      });
    }

    const live = await this.schedules.liveBook(scope);
    if (!live) {
      await this.prisma.aiSchedule.update({
        where: { id: s.id },
        data: { active: false, nextRunAt: null },
      });
      return record({
        channel: 'NONE',
        ok: false,
        error: 'This book no longer exists.',
      });
    }
    const delivery = await this.delivery(s);
    if (!delivery.channel || !delivery.to) {
      return record({
        channel: 'NONE',
        ok: false,
        error: 'No email address or phone number to send to.',
      });
    }

    const text = await this.assistant.runTask(scope, s.task, delivery.channel);
    if (!text) {
      return record({
        channel: delivery.channel,
        ok: false,
        error: 'The AI could not prepare the message this time.',
      });
    }

    if (delivery.channel === 'SMS') {
      const outcome = await this.messenger.send({
        channel: 'SMS',
        to: delivery.to,
        body: text,
      });
      if (outcome === 'sent') {
        await this.schedules.logText(scope, delivery.to, text);
        return record({ channel: 'SMS', ok: true, text });
      }
      if (!live.email) {
        return record({
          channel: 'SMS',
          ok: false,
          text,
          error: `The text was not sent (${outcome}).`,
        });
      }
      const failed = await this.email(live.email, s.title, text);
      return record({
        channel: 'EMAIL',
        ok: failed === null,
        text,
        error: `The text was not sent (${outcome}), so it was emailed${failed ? ` — and the email failed: ${failed}` : ''}.`,
      });
    }
    const failed = await this.email(delivery.to, s.title, text);
    return record({
      channel: 'EMAIL',
      ok: failed === null,
      text,
      error: failed,
    });
  }

  private email(to: string, title: string, text: string) {
    return this.schedules.email(to, {
      subject: title,
      text,
      html: answerHtml(text),
      attachments: [],
    });
  }

  /**
   * Where this schedule goes now: the channel the customer asked for when it can be used,
   * else their preferred contact (never a call — see the class comment).
   */
  private async delivery(s: AiSchedule): Promise<AiScheduleView['delivery']> {
    const c = await this.prisma.customer.findUnique({
      where: { id: s.customerId },
      select: { email: true, phoneE164: true },
    });
    if (!c) return { channel: null, to: null };
    const canText = Boolean(c.phoneE164) && this.messenger.smsConfigured;
    if (s.channel === 'SMS' && canText) {
      return { channel: 'SMS', to: c.phoneE164 };
    }
    if (s.channel === 'EMAIL' || s.channel === 'SMS') {
      return c.email
        ? { channel: 'EMAIL', to: c.email }
        : canText
          ? { channel: 'SMS', to: c.phoneE164 }
          : { channel: null, to: null };
    }
    const preferred = await this.schedules.delivery(s.customerId, true);
    return preferred.channel === 'SMS' || preferred.channel === 'EMAIL'
      ? { channel: preferred.channel, to: preferred.to }
      : { channel: null, to: null };
  }

  private async view(s: AiSchedule): Promise<AiScheduleView> {
    const runs = await this.prisma.aiScheduleRun.findMany({
      where: { scheduleId: s.id },
      orderBy: { id: 'desc' },
      take: 5,
    });
    const rule = aiRuleOf(s);
    return {
      id: s.id,
      title: s.title,
      task: s.task,
      frequency: rule.frequency,
      weekday: s.weekday,
      monthDay: s.monthDay,
      time: s.time,
      timezone: s.timezone,
      description: this.store.describe(s),
      channel: s.channel === 'EMAIL' || s.channel === 'SMS' ? s.channel : null,
      active: s.active,
      createdBy: s.createdBy === 'CUSTOMER' ? 'CUSTOMER' : 'AI',
      nextRunAt: s.nextRunAt?.toISOString() ?? null,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      delivery: await this.delivery(s),
      runs: runs.map((r) => ({
        at: r.createdAt.toISOString(),
        channel: r.channel,
        ok: r.ok,
        error: r.error,
        manual: r.manual,
        text: r.text,
      })),
    };
  }
}
