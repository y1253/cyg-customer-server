import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AiSchedule } from '@prisma/client';
import { scopeWhere, type BookScope } from '../bookkeeping/scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_FREQUENCIES,
  DEFAULT_TIMEZONE,
  describeRule,
  nextRun,
  parseTime,
  safeZone,
  type Frequency,
  type ScheduleRule,
} from './next-run.util';

/** How an AI schedule is sent: a fixed channel, or (null) the customer's preferred one. */
export type AiScheduleChannel = 'EMAIL' | 'SMS';
export const AI_SCHEDULE_CHANNELS: readonly AiScheduleChannel[] = [
  'EMAIL',
  'SMS',
];

export interface AiScheduleInput {
  title?: string;
  task?: string;
  frequency?: Frequency;
  weekday?: number | null;
  monthDay?: number | null;
  time?: string;
  timezone?: string;
  channel?: AiScheduleChannel | null;
  active?: boolean;
}

/** A book can hold at most this many AI schedules (a runaway agent must not flood a phone). */
export const MAX_AI_SCHEDULES = 20;

export const aiRuleOf = (s: AiSchedule): ScheduleRule => ({
  frequency:
    s.frequency === 'DAILY' || s.frequency === 'MONTHLY'
      ? s.frequency
      : 'WEEKLY',
  weekday: s.weekday,
  monthDay: s.monthDay,
  time: s.time,
  timezone: s.timezone,
});

const isChannel = (c: unknown): c is AiScheduleChannel =>
  c === 'EMAIL' || c === 'SMS';

/**
 * step12: the schedules a customer asks the AI for (`AiSchedule`) — the book-scoped rows
 * and their rules, with no sending. Lives apart from `AiSchedulesService` (which sends)
 * so the assistant's tools can create rows without the assistant module depending on the
 * schedules module (which depends on the assistant).
 */
@Injectable()
export class AiSchedulesStore {
  constructor(private readonly prisma: PrismaService) {}

  list(scope: BookScope): Promise<AiSchedule[]> {
    return this.prisma.aiSchedule.findMany({
      where: { ...scopeWhere(scope), deletedAt: null },
      orderBy: { id: 'asc' },
    });
  }

  async get(scope: BookScope, id: number): Promise<AiSchedule> {
    const row = await this.prisma.aiSchedule.findFirst({
      where: { id, ...scopeWhere(scope), deletedAt: null },
    });
    if (!row) throw new NotFoundException('Schedule not found');
    return row;
  }

  async create(
    scope: BookScope,
    input: AiScheduleInput,
    meta: { createdBy: 'AI' | 'CUSTOMER'; conversationId?: number | null },
  ): Promise<AiSchedule> {
    const count = await this.prisma.aiSchedule.count({
      where: { ...scopeWhere(scope), deletedAt: null },
    });
    if (count >= MAX_AI_SCHEDULES) {
      throw new BadRequestException(
        `This book already has ${MAX_AI_SCHEDULES} schedules — delete one first.`,
      );
    }
    const title = input.title?.trim();
    const task = input.task?.trim();
    if (!title)
      throw new BadRequestException('Give the schedule a short title');
    if (!task) {
      throw new BadRequestException(
        'Say what should be sent each time (the task)',
      );
    }
    const rule = this.rule(
      {
        frequency: input.frequency ?? 'DAILY',
        weekday: input.weekday ?? null,
        monthDay: input.monthDay ?? null,
        time: input.time ?? '09:00',
        timezone: input.timezone
          ? safeZone(input.timezone)
          : await this.bookZone(scope),
      },
      input,
    );
    const active = input.active ?? true;
    return this.prisma.aiSchedule.create({
      data: {
        ...scopeWhere(scope),
        title: title.slice(0, 120),
        task: task.slice(0, 4000),
        ...rule,
        channel: this.channel(input.channel),
        active,
        createdBy: meta.createdBy,
        conversationId: meta.conversationId ?? null,
        nextRunAt: active ? nextRun(rule, new Date()) : null,
      },
    });
  }

  async update(
    scope: BookScope,
    id: number,
    input: AiScheduleInput,
  ): Promise<AiSchedule> {
    const row = await this.get(scope, id);
    const rule = this.rule(aiRuleOf(row), input);
    const active = input.active ?? row.active;
    const title = input.title !== undefined ? input.title.trim() : row.title;
    const task = input.task !== undefined ? input.task.trim() : row.task;
    if (!title)
      throw new BadRequestException('Give the schedule a short title');
    if (!task) throw new BadRequestException('The task cannot be empty');
    return this.prisma.aiSchedule.update({
      where: { id: row.id },
      data: {
        title: title.slice(0, 120),
        task: task.slice(0, 4000),
        ...rule,
        channel:
          input.channel !== undefined
            ? this.channel(input.channel)
            : row.channel,
        active,
        nextRunAt: active ? nextRun(rule, new Date()) : null,
      },
    });
  }

  async remove(scope: BookScope, id: number): Promise<AiSchedule> {
    const row = await this.get(scope, id);
    return this.prisma.aiSchedule.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), active: false, nextRunAt: null },
    });
  }

  /** A short description for the assistant and the tab. */
  describe(s: AiSchedule): string {
    return describeRule(aiRuleOf(s));
  }

  /** `base` with the input's changes, checked; throws a customer-readable 400. */
  private rule(base: ScheduleRule, input: AiScheduleInput): ScheduleRule {
    const rule: ScheduleRule = {
      frequency: input.frequency ?? base.frequency,
      weekday: input.weekday !== undefined ? input.weekday : base.weekday,
      monthDay: input.monthDay !== undefined ? input.monthDay : base.monthDay,
      time: input.time?.trim() ?? base.time,
      timezone: input.timezone ? safeZone(input.timezone) : base.timezone,
    };
    if (!AI_FREQUENCIES.includes(rule.frequency)) {
      throw new BadRequestException('Repeat must be DAILY, WEEKLY or MONTHLY');
    }
    if (!parseTime(rule.time)) {
      throw new BadRequestException('Choose a time like 06:00 (24 h)');
    }
    if (rule.frequency === 'DAILY') {
      rule.weekday = null;
      rule.monthDay = null;
    } else if (rule.frequency === 'WEEKLY') {
      if (rule.weekday === null || rule.weekday < 0 || rule.weekday > 6) {
        throw new BadRequestException(
          'Choose a day of the week (0 = Sunday … 6 = Saturday)',
        );
      }
      rule.monthDay = null;
    } else {
      if (rule.monthDay === null || rule.monthDay < 0 || rule.monthDay > 28) {
        throw new BadRequestException(
          'Choose a day of the month (1–28, or 0 = the last day)',
        );
      }
      rule.weekday = null;
    }
    return rule;
  }

  private channel(c: unknown): AiScheduleChannel | null {
    if (c === null || c === undefined || c === '') return null;
    if (!isChannel(c)) {
      throw new BadRequestException('Send by EMAIL or SMS (or leave it empty)');
    }
    return c;
  }

  /** The book's time zone: the one its built-in schedules were last saved in. */
  private async bookZone(scope: BookScope): Promise<string> {
    const s = await this.prisma.bookSchedule.findFirst({
      where: scopeWhere(scope),
      orderBy: { updatedAt: 'desc' },
      select: { timezone: true },
    });
    return safeZone(s?.timezone ?? DEFAULT_TIMEZONE);
  }
}
