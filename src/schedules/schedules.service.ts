import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AttachmentStatus,
  BookScheduleType,
  StatementStatus,
  type BookSchedule,
  type BookScheduleRun,
} from '@prisma/client';
import { AssistantService } from '../assistant/assistant.service';
import { UNCATEGORIZED } from '../bookkeeping/chart-of-accounts';
import { FileLinkService } from '../bookkeeping/file-links';
import { reportPdf } from '../bookkeeping/report-pdf';
import { ReportsService } from '../bookkeeping/reports.service';
import { scopeWhere, type BookScope } from '../bookkeeping/scope';
import { TaxService } from '../bookkeeping/tax.service';
import { MailService } from '../mail/mail.service';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceCallsService } from '../voice/voice-calls.service';
import { spokenScript } from '../voice/voice.util';
import {
  DEFAULT_TIMEZONE,
  describeRule,
  nextRun,
  parseTime,
  previousMonth,
  safeZone,
  type Frequency,
  type ScheduleRule,
} from './next-run.util';
import {
  accountStatusMessage,
  financialReportMessage,
  nothingOpen,
  type AccountStatus,
} from './schedule-messages.util';

/** CALL (step12) = the AI phones the customer, says the message, answers questions. */
export type DeliveryChannel = 'EMAIL' | 'SMS' | 'CALL';

export interface ScheduleRunView {
  at: string;
  channel: string;
  ok: boolean;
  error: string | null;
  manual: boolean;
  text: string | null;
}

export interface ScheduleView {
  type: BookScheduleType;
  enabled: boolean;
  frequency: Frequency;
  weekday: number | null;
  monthDay: number | null;
  time: string;
  timezone: string;
  /** "Every Monday at 2:00 PM". */
  description: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** How it will reach the customer: their preferred contact, as we can honour it. */
  delivery: {
    channel: DeliveryChannel | null;
    to: string | null;
    preferred: string | null;
  };
  runs: ScheduleRunView[];
}

export interface ScheduleInput {
  enabled?: boolean;
  frequency?: Frequency;
  weekday?: number | null;
  monthDay?: number | null;
  time?: string;
  timezone?: string;
}

/** What each schedule starts as (off until the customer turns it on). */
const DEFAULTS: Record<BookScheduleType, Omit<ScheduleRule, 'timezone'>> = {
  ACCOUNT_STATUS: {
    frequency: 'WEEKLY',
    weekday: 1,
    monthDay: null,
    time: '14:00',
  },
  FINANCIAL_REPORT: {
    frequency: 'MONTHLY',
    weekday: null,
    monthDay: 1,
    time: '09:00',
  },
};

const TYPES: BookScheduleType[] = ['ACCOUNT_STATUS', 'FINANCIAL_REPORT'];
const BATCH = 20;

const ruleOf = (s: BookSchedule): ScheduleRule => ({
  frequency: s.frequency === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY',
  weekday: s.weekday,
  monthDay: s.monthDay,
  time: s.time,
  timezone: s.timezone,
});

/**
 * step11b: a book's scheduled messages to its customer — the Schedules tab. Two per book:
 * the weekly **Account Status Overview** (what is still open: unfiled receipts, Uncategorized
 * rows, unrecognized names…) and the monthly **Financial Report** (last month's income
 * statement + balance sheet, as a PDF on the email or a link in a text).
 *
 * They go by the customer's preferred contact (`Customer.preferredContact`): EMAIL, or a
 * TEXT for SMS **and** WhatsApp (user's decision 2026-10-21: "make only text/email, so a
 * customer who prefers WhatsApp gets a text"). No phone / texts not set up / opted out →
 * email. A text is also saved in that phone's assistant chat, so a reply continues it.
 *
 * A minute cron sends what is due. Each row is CLAIMED (conditional update moving
 * `nextRunAt` forward) before anything is sent, so one tick never sends twice.
 */
@Injectable()
export class SchedulesService implements OnModuleInit {
  private readonly logger = new Logger(SchedulesService.name);
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly messenger: CustomerMessenger,
    private readonly links: FileLinkService,
    private readonly reports: ReportsService,
    private readonly tax: TaxService,
    private readonly assistant: AssistantService,
    private readonly voice: VoiceCallsService,
  ) {}

  /**
   * step12: a schedule CALL nobody answered (no answer, busy, failed) is sent again by
   * text, else by email — the run row says so.
   */
  onModuleInit(): void {
    this.voice.outboundMissed$.subscribe(({ runId, status }) => {
      void this.callMissed(runId, status).catch((err: unknown) =>
        this.logger.error(
          `schedule run #${runId} fallback FAILED: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    });
  }

  private async callMissed(runId: number, status: string): Promise<void> {
    const run = await this.prisma.bookScheduleRun.findUnique({
      where: { id: runId },
      include: { schedule: true },
    });
    if (!run || run.channel !== 'CALL') return;
    await this.prisma.bookScheduleRun.update({
      where: { id: run.id },
      data: {
        ok: false,
        error: `The call was not answered (${status}), so it was sent again another way.`,
      },
    });
    await this.run(run.schedule, run.manual, 'NO_CALL');
  }

  // ---- the Schedules tab -------------------------------------------------------------

  async list(scope: BookScope): Promise<ScheduleView[]> {
    const rows = await Promise.all(TYPES.map((t) => this.ensure(scope, t)));
    const delivery = await this.delivery(scope.customerId);
    return Promise.all(rows.map((r) => this.view(r, delivery)));
  }

  async update(
    scope: BookScope,
    type: BookScheduleType,
    input: ScheduleInput,
  ): Promise<ScheduleView> {
    const row = await this.ensure(scope, type);
    const rule: ScheduleRule = {
      frequency: input.frequency ?? ruleOf(row).frequency,
      weekday: input.weekday !== undefined ? input.weekday : row.weekday,
      monthDay: input.monthDay !== undefined ? input.monthDay : row.monthDay,
      time: input.time ?? row.time,
      timezone: input.timezone ? safeZone(input.timezone) : row.timezone,
    };
    if (!parseTime(rule.time)) {
      throw new BadRequestException('Choose a time like 14:00');
    }
    if (rule.frequency === 'WEEKLY') {
      if (rule.weekday === null || rule.weekday < 0 || rule.weekday > 6) {
        throw new BadRequestException('Choose a day of the week');
      }
      rule.monthDay = null;
    } else {
      if (rule.monthDay === null || rule.monthDay < 0 || rule.monthDay > 28) {
        throw new BadRequestException(
          'Choose a day of the month (1–28, or the last day)',
        );
      }
      rule.weekday = null;
    }
    const enabled = input.enabled ?? row.enabled;
    const saved = await this.prisma.bookSchedule.update({
      where: { id: row.id },
      data: {
        ...rule,
        enabled,
        nextRunAt: enabled ? nextRun(rule, new Date()) : null,
      },
    });
    return this.view(saved, await this.delivery(scope.customerId));
  }

  /** "Send now": the message goes out at once; the schedule itself is unchanged. */
  async sendNow(
    scope: BookScope,
    type: BookScheduleType,
  ): Promise<ScheduleView> {
    const row = await this.ensure(scope, type);
    await this.run(row, true);
    const fresh = await this.prisma.bookSchedule.findUniqueOrThrow({
      where: { id: row.id },
    });
    return this.view(fresh, await this.delivery(scope.customerId));
  }

  // ---- the cron ------------------------------------------------------------------------

  /** Every minute: send what is due (step11b). */
  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = new Date();
      const due = await this.prisma.bookSchedule.findMany({
        where: { enabled: true, nextRunAt: { lte: now } },
        orderBy: { nextRunAt: 'asc' },
        take: BATCH,
      });
      for (const s of due) {
        const claimed = await this.prisma.bookSchedule.updateMany({
          where: { id: s.id, enabled: true, nextRunAt: s.nextRunAt },
          data: { nextRunAt: nextRun(ruleOf(s), now), lastRunAt: now },
        });
        if (!claimed.count) continue;
        await this.run(s, false).catch((err: unknown) =>
          this.logger.error(
            `schedule #${s.id} FAILED: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    } catch (err) {
      this.logger.error(
        `tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  // ---- one send ------------------------------------------------------------------------

  private async run(
    s: BookSchedule,
    manual: boolean,
    /** NO_CALL = a call was just missed: text or email instead (step12). */
    mode: 'NORMAL' | 'NO_CALL' = 'NORMAL',
  ): Promise<BookScheduleRun> {
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
      this.prisma.bookScheduleRun.create({
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
      await this.prisma.bookSchedule.update({
        where: { id: s.id },
        data: { lastRunAt: new Date() },
      });
    }

    const live = await this.liveBook(scope);
    if (!live) {
      await this.prisma.bookSchedule.update({
        where: { id: s.id },
        data: { enabled: false, nextRunAt: null },
      });
      return record({
        channel: 'NONE',
        ok: false,
        error: 'This book no longer exists.',
      });
    }
    const delivery = await this.delivery(scope.customerId, mode === 'NO_CALL');
    if (!delivery.channel || !delivery.to) {
      return record({
        channel: 'NONE',
        ok: false,
        error: 'No email address or phone number to send to.',
      });
    }
    const firstName = live.customerName.trim().split(/\s+/)[0] ?? '';
    const compose = (sms: boolean) =>
      this.compose(s, scope, { firstName, book: live.book }, sms);

    if (delivery.channel === 'CALL') {
      const spoken = await compose(true);
      if ('skip' in spoken) {
        return record({ channel: 'NONE', ok: true, text: spoken.skip });
      }
      const script = spokenScript(spoken.text);
      // The run is written first: the call carries its id, and SignalWire's report of a
      // missed call finds it (`callMissed`).
      const row = await record({ channel: 'CALL', ok: true, text: script });
      const placed = await this.voice.callCustomer({
        scope,
        peer: delivery.to,
        purpose: s.type,
        runId: row.id,
        script,
      });
      if ('error' in placed) {
        await this.prisma.bookScheduleRun.update({
          where: { id: row.id },
          data: {
            ok: false,
            error: `The call could not be placed: ${placed.error}`,
          },
        });
        return this.run(s, manual, 'NO_CALL');
      }
      return row;
    }

    const first = await compose(delivery.channel === 'SMS');
    if ('skip' in first) {
      return record({ channel: 'NONE', ok: true, text: first.skip });
    }
    if (delivery.channel === 'SMS') {
      const outcome = await this.messenger.send({
        channel: 'SMS',
        to: delivery.to,
        body: first.text,
      });
      if (outcome === 'sent') {
        await this.logText(scope, delivery.to, first.text);
        return record({ channel: 'SMS', ok: true, text: first.text });
      }
      // Could not text (opted out, provider error): email it instead when we can.
      if (!live.email) {
        return record({
          channel: 'SMS',
          ok: false,
          text: first.text,
          error: `The text was not sent (${outcome}).`,
        });
      }
      const mail = await compose(false);
      if ('skip' in mail)
        return record({ channel: 'NONE', ok: true, text: mail.skip });
      const sent = await this.email(live.email, mail);
      return record({
        channel: 'EMAIL',
        ok: sent === null,
        text: mail.text,
        error: `The text was not sent (${outcome}), so it was emailed${sent ? ` — and the email failed: ${sent}` : ''}.`,
      });
    }
    const sent = await this.email(delivery.to, first);
    return record({
      channel: 'EMAIL',
      ok: sent === null,
      text: first.text,
      error: sent,
    });
  }

  /** The message itself, or why there is nothing to send. */
  private async compose(
    s: BookSchedule,
    scope: BookScope,
    who: { firstName: string; book: string },
    sms: boolean,
  ): Promise<
    | { skip: string }
    | {
        subject: string;
        text: string;
        html: string;
        attachments: Array<{
          filename: string;
          content: Buffer;
          contentType: string;
        }>;
      }
  > {
    if (s.type === 'ACCOUNT_STATUS') {
      const status = await this.status(scope, s.lastRunAt);
      if (nothingOpen(status))
        return { skip: 'Nothing to review — no message sent.' };
      return {
        ...accountStatusMessage({
          firstName: who.firstName,
          book: who.book,
          status,
          link: this.dashboardLink(scope),
          sms,
        }),
        attachments: [],
      };
    }
    const period = previousMonth(new Date(), s.timezone);
    const view = await this.reports.reports(scope, period.from, period.to);
    const is = view.incomeStatement;
    if (!is.income.length && !is.expenses.length) {
      return { skip: `No transactions in ${period.label} — no report sent.` };
    }
    const link = await this.links.link(scope, {
      kind: 'report',
      from: period.from,
      to: period.to,
    });
    const message = financialReportMessage({
      firstName: who.firstName,
      book: who.book,
      period: period.label,
      income: is.totalIncome,
      expenses: is.totalExpenses,
      net: is.netIncome,
      uncategorized: view.uncategorized.count,
      link,
      sms,
    });
    return {
      ...message,
      attachments: sms
        ? []
        : [
            {
              filename: `Financial report ${period.label}.pdf`,
              content: await reportPdf(view, who.book),
              contentType: 'application/pdf',
            },
          ],
    };
  }

  /** Sends one scheduled email; null = sent, else why not. */
  private async email(
    to: string,
    m: {
      subject: string;
      text: string;
      html: string;
      attachments: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
      }>;
    },
  ): Promise<string | null> {
    try {
      await this.mail.send({
        to,
        subject: m.subject,
        text: m.text,
        html: m.html,
        fromName: 'CYG Finance',
        attachments: m.attachments,
      });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  /** What is still open in the book (the overview's items). */
  async status(scope: BookScope, since: Date | null): Promise<AccountStatus> {
    const book = scopeWhere(scope);
    const from = since ?? new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const [
      unmatchedFiles,
      newDocuments,
      uncategorized,
      statementsToReview,
      statementsWaiting,
      names,
    ] = await Promise.all([
      this.prisma.transactionAttachment.count({
        where: {
          ...book,
          deletedAt: null,
          status: { in: [AttachmentStatus.UNMATCHED, AttachmentStatus.FAILED] },
        },
      }),
      this.prisma.transactionAttachment.count({
        where: {
          ...book,
          deletedAt: null,
          status: AttachmentStatus.DOCUMENT,
          createdAt: { gte: from },
        },
      }),
      this.prisma.bankTransaction.count({
        where: {
          ...book,
          offsetAccount: UNCATEGORIZED,
          splitOfId: null,
          statement: { deletedAt: null, status: StatementStatus.DONE },
        },
      }),
      this.prisma.bankStatement.count({
        where: {
          ...book,
          deletedAt: null,
          status: {
            in: [StatementStatus.FAILED, StatementStatus.NEEDS_REVIEW],
          },
        },
      }),
      this.prisma.bankStatement.count({
        where: { ...book, deletedAt: null, status: StatementStatus.UPLOADED },
      }),
      this.tax.names(scope).catch(() => null),
    ]);
    return {
      unmatchedFiles,
      newDocuments,
      uncategorized,
      unrecognizedNames: names?.unrecognized.length ?? 0,
      statementsToReview,
      statementsWaiting,
    };
  }

  // ---- helpers -----------------------------------------------------------------------

  /** The book's row of this type, created (off, with the defaults) on first look. */
  private async ensure(
    scope: BookScope,
    type: BookScheduleType,
  ): Promise<BookSchedule> {
    // NULL companyId keys are distinct in MySQL: find-then-create, never upsert.
    const found = await this.prisma.bookSchedule.findFirst({
      where: { ...scopeWhere(scope), type },
      orderBy: { id: 'asc' },
    });
    if (found) return found;
    return this.prisma.bookSchedule.create({
      data: {
        ...scopeWhere(scope),
        type,
        ...DEFAULTS[type],
        timezone: DEFAULT_TIMEZONE,
        enabled: false,
      },
    });
  }

  private async view(
    s: BookSchedule,
    delivery: ScheduleView['delivery'],
  ): Promise<ScheduleView> {
    const runs = await this.prisma.bookScheduleRun.findMany({
      where: { scheduleId: s.id },
      orderBy: { id: 'desc' },
      take: 5,
    });
    const rule = ruleOf(s);
    return {
      type: s.type,
      enabled: s.enabled,
      frequency: rule.frequency,
      weekday: s.weekday,
      monthDay: s.monthDay,
      time: s.time,
      timezone: s.timezone,
      description: describeRule(rule),
      nextRunAt: s.nextRunAt?.toISOString() ?? null,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      delivery,
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

  /**
   * How a scheduled message reaches this customer: a TEXT when they prefer SMS or WhatsApp
   * and have a phone we can text, else their email address.
   */
  private async delivery(
    customerId: number,
    /** A call was just missed: the text / email fallback. */
    noCall = false,
  ): Promise<ScheduleView['delivery']> {
    const c = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { email: true, phoneE164: true, preferredContact: true },
    });
    if (!c) return { channel: null, to: null, preferred: null };
    // step12: "Phone call" — the AI calls them (when calls are set up), else a text.
    if (
      !noCall &&
      c.preferredContact === 'CALL' &&
      c.phoneE164 &&
      (await this.voice.canCall())
    ) {
      return {
        channel: 'CALL',
        to: c.phoneE164,
        preferred: c.preferredContact,
      };
    }
    const wantsText =
      c.preferredContact === 'SMS' ||
      c.preferredContact === 'WHATSAPP' ||
      c.preferredContact === 'CALL';
    if (wantsText && c.phoneE164 && this.messenger.smsConfigured) {
      return { channel: 'SMS', to: c.phoneE164, preferred: c.preferredContact };
    }
    return {
      channel: c.email ? 'EMAIL' : null,
      to: c.email ?? null,
      preferred: c.preferredContact,
    };
  }

  /** The customer and the book's display name, or null when either is gone. */
  private async liveBook(scope: BookScope): Promise<{
    customerName: string;
    email: string | null;
    book: string;
  } | null> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: scope.customerId, deletedAt: null },
      select: { name: true, email: true },
    });
    if (!customer) return null;
    if (scope.companyId === null) {
      return {
        customerName: customer.name,
        email: customer.email,
        book: 'your personal books',
      };
    }
    const company = await this.prisma.company.findFirst({
      where: {
        id: scope.companyId,
        customerId: scope.customerId,
        isDraft: false,
        isInternal: false,
        deletedAt: null,
      },
      select: { businessName: true },
    });
    return company
      ? {
          customerName: customer.name,
          email: customer.email,
          book: company.businessName,
        }
      : null;
  }

  /** Where the customer opens this book on the website. */
  private dashboardLink(scope: BookScope): string {
    const base =
      this.config.get<string>('PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '') ||
      'https://cygfinance.com';
    return scope.companyId === null
      ? `${base}/dashboard/bookkeeping`
      : `${base}/dashboard/businesses/${scope.companyId}`;
  }

  /**
   * A sent text is saved in that phone's assistant chat, so when the customer replies the
   * assistant knows what they are answering. A new chat starts on this book.
   */
  private async logText(
    scope: BookScope,
    phone: string,
    text: string,
  ): Promise<void> {
    try {
      const conversation =
        (await this.prisma.aiConversation.findFirst({
          where: {
            customerId: scope.customerId,
            channel: 'SMS',
            peer: phone,
            attachmentId: null,
          },
          orderBy: { id: 'desc' },
        })) ??
        (await this.prisma.aiConversation.create({
          data: {
            customerId: scope.customerId,
            companyId: scope.companyId,
            channel: 'SMS',
            peer: phone,
            bookChosen: true,
          },
        }));
      await this.assistant.save(conversation, 'ASSISTANT', text);
    } catch (err) {
      this.logger.warn(
        `schedule text not logged: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 404 unless the type is one of ours. */
  static typeOf(raw: string): BookScheduleType {
    const t = raw.toUpperCase().replace(/-/g, '_');
    if (t === 'ACCOUNT_STATUS' || t === 'FINANCIAL_REPORT') return t;
    throw new NotFoundException('Unknown schedule');
  }
}
