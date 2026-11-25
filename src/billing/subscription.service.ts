import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CustomerSubscription, SubscriptionPlan } from '@prisma/client';
import type { BookScope } from '../bookkeeping/scope';
import { MailService } from '../mail/mail.service';
import { CustomerMessenger } from '../messaging/customer-messenger.service';
import { PrismaService } from '../prisma/prisma.service';
import { billingHooks } from './billing-hooks';
import {
  accessOf,
  FREE_TEXT_PURPOSES,
  lockedText,
  monthlyUsage,
  monthOf,
  nextMonthStart,
  trialUsedUp,
  type Access,
  type TrialAllowance,
  type TrialItem,
} from './entitlement.util';

const CACHE_MS = 30_000;
const PLAN_CACHE_MS = 60_000;

export interface Allowance {
  used: number;
  limit: number;
}

/** Everything the app needs to know about one customer's access right now. */
export interface AccessState extends Access {
  /** The free trial (while it applies, or once used up). */
  trial: {
    transactions: Allowance;
    texts: Allowance;
    callMinutes: Allowance;
    usedUp: TrialItem[];
  } | null;
  /** This month's transactions (paid / free promo). */
  monthly: {
    month: string;
    used: number;
    limit: number;
    remaining: number;
    warn: boolean;
    reached: boolean;
    resetsAt: string;
  } | null;
  /** Customer-readable, when locked. */
  lockedText: string | null;
}

/** 402: the whole app is locked. The client goes to the Subscribe page. */
export class SubscriptionRequiredException extends HttpException {
  constructor(reason: string, message: string) {
    super(
      { statusCode: 402, code: 'SUBSCRIPTION_REQUIRED', reason, message },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/** 429: no new transactions this month (or in the trial). */
export class TransactionLimitException extends HttpException {
  constructor(state: AccessState) {
    const trial = state.limited === 'TRIAL';
    super(
      {
        statusCode: 429,
        code: 'TRANSACTION_LIMIT',
        message: trial
          ? `Your free trial's ${state.trial?.transactions.limit ?? 0} transactions are used up — subscribe to read more.`
          : `You reached your ${state.monthly?.limit.toLocaleString('en-US') ?? ''} transactions for this month. It resets on ${state.monthly ? new Date(state.monthly.resetsAt).toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: 'long', day: 'numeric' }) : 'the 1st'}.`,
        used: trial ? state.trial?.transactions.used : state.monthly?.used,
        limit: trial ? state.trial?.transactions.limit : state.monthly?.limit,
        resetsAt: trial ? null : (state.monthly?.resetsAt ?? null),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * 2026-11-25: who may use the app, and how much. Global (the JWT guard, the queues, the
 * messenger and the AI channels all ask it). Stripe itself is `StripeBillingService`; this
 * only reads `CustomerSubscription` (+ counts usage).
 *
 * - access = `accessOf` (entitlement.util.ts): free promo / paid (PAST_DUE = grace) / trial /
 *   locked. Cached 30 s per customer, dropped on every write here and every usage record.
 * - the free trial counts from `trialStartedAt`: new transactions (`TransactionUsage`), AI
 *   texts (`CommMessage` OUT, minus `FREE_TEXT_PURPOSES`), AI call minutes (`CommCall`).
 * - the monthly limit: Σ `TransactionUsage.transactions` this Toronto month.
 */
@Injectable()
export class SubscriptionService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionService.name);
  private planCache: { at: number; plan: SubscriptionPlan } | null = null;
  private readonly cache = new Map<number, { at: number; state: AccessState }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly messenger: CustomerMessenger,
    private readonly mail: MailService,
  ) {}

  onModuleInit(): void {
    billingHooks.usageChanged = (customerId) => this.forget(customerId);
    billingHooks.allowText = (customerId, purpose) =>
      this.allowText(customerId, purpose);
  }

  forget(customerId: number): void {
    this.cache.delete(customerId);
  }

  async plan(): Promise<SubscriptionPlan> {
    if (this.planCache && Date.now() - this.planCache.at < PLAN_CACHE_MS)
      return this.planCache.plan;
    const plan = await this.prisma.subscriptionPlan.upsert({
      where: { singleton: 'GLOBAL' },
      create: {},
      update: {},
    });
    this.planCache = { at: Date.now(), plan };
    return plan;
  }

  /** The customer's row, created (trial starts now) on the first look. */
  async row(customerId: number): Promise<CustomerSubscription> {
    const found = await this.prisma.customerSubscription.findUnique({
      where: { customerId },
    });
    if (found) return found;
    try {
      return await this.prisma.customerSubscription.create({
        data: { customerId, trialStartedAt: new Date() },
      });
    } catch {
      // Two first requests at once: the other one created it.
      return this.prisma.customerSubscription.findUniqueOrThrow({
        where: { customerId },
      });
    }
  }

  async state(customerId: number): Promise<AccessState> {
    const hit = this.cache.get(customerId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;
    const state = await this.compute(customerId);
    this.cache.set(customerId, { at: Date.now(), state });
    return state;
  }

  private async compute(customerId: number): Promise<AccessState> {
    const [sub, plan] = await Promise.all([this.row(customerId), this.plan()]);
    const allowance: TrialAllowance = {
      transactions: plan.trialTransactions,
      texts: plan.trialTexts,
      callMinutes: plan.trialCallMinutes,
    };
    const trialUsed = sub.everPaid
      ? null
      : await this.trialUsage(customerId, sub.trialStartedAt ?? sub.createdAt);
    const access = accessOf(
      sub,
      trialUsed ? { allowance, used: trialUsed } : null,
    );
    const usedUp = trialUsed ? trialUsedUp(allowance, trialUsed) : [];
    const trial =
      trialUsed && (access.reason === 'TRIAL' || access.reason === 'TRIAL_USED')
        ? {
            transactions: {
              used: trialUsed.transactions,
              limit: allowance.transactions,
            },
            texts: { used: trialUsed.texts, limit: allowance.texts },
            callMinutes: {
              used: trialUsed.callMinutes,
              limit: allowance.callMinutes,
            },
            usedUp,
          }
        : null;
    let monthly: AccessState['monthly'] = null;
    if (access.limited === 'MONTHLY') {
      const month = monthOf();
      const used = await this.monthUsed(customerId, month);
      const limit = sub.transactionLimit ?? plan.monthlyTransactionLimit;
      monthly = {
        month,
        used,
        limit,
        ...monthlyUsage(used, limit, plan.warnPercent),
        resetsAt: nextMonthStart().toISOString(),
      };
    }
    return {
      ...access,
      trial,
      monthly,
      lockedText: access.active ? null : lockedText(access.reason, usedUp),
    };
  }

  private async trialUsage(
    customerId: number,
    since: Date,
  ): Promise<TrialAllowance> {
    const [tx, texts, calls] = await Promise.all([
      this.prisma.transactionUsage.aggregate({
        where: { customerId, createdAt: { gte: since } },
        _sum: { transactions: true },
      }),
      this.prisma.commMessage.count({
        where: {
          customerId,
          direction: 'OUT',
          createdAt: { gte: since },
          purpose: { notIn: [...FREE_TEXT_PURPOSES] },
        },
      }),
      this.prisma.commCall.findMany({
        where: {
          customerId,
          createdAt: { gte: since },
          purpose: { not: 'PROSPECT' },
        },
        select: { durationSec: true },
      }),
    ]);
    return {
      transactions: tx._sum.transactions ?? 0,
      texts,
      callMinutes: calls.reduce(
        (n, c) => n + Math.ceil(Math.max(0, c.durationSec) / 60),
        0,
      ),
    };
  }

  private async monthUsed(customerId: number, month: string): Promise<number> {
    const r = await this.prisma.transactionUsage.aggregate({
      where: { customerId, month },
      _sum: { transactions: true },
    });
    return r._sum.transactions ?? 0;
  }

  /** Throws the 402 the client turns into the Subscribe page. */
  async assertActive(customerId: number): Promise<AccessState> {
    const state = await this.state(customerId);
    if (!state.active)
      throw new SubscriptionRequiredException(
        state.reason,
        state.lockedText ?? 'Subscribe to keep going.',
      );
    return state;
  }

  /**
   * How many NEW transactions this customer may still add (Infinity = no limit applies,
   * 0 = stop). Locked accounts get 0.
   */
  async remainingTransactions(customerId: number): Promise<number> {
    const s = await this.state(customerId);
    if (!s.active) return 0;
    if (s.limited === 'TRIAL' && s.trial)
      return Math.max(0, s.trial.transactions.limit - s.trial.transactions.used);
    if (s.limited === 'MONTHLY' && s.monthly) return s.monthly.remaining;
    return Number.POSITIVE_INFINITY;
  }

  /** Generate: 402 when locked, 429 at the limit. */
  async assertCanAddTransactions(customerId: number): Promise<void> {
    const state = await this.assertActive(customerId);
    if ((await this.remainingTransactions(customerId)) <= 0)
      throw new TransactionLimitException(state);
  }

  /** AI call minutes left (null = no limit). 0 = no AI call. */
  async callMinutesLeft(customerId: number): Promise<number | null> {
    const s = await this.state(customerId);
    if (!s.active) return 0;
    if (s.limited === 'TRIAL' && s.trial)
      return Math.max(0, s.trial.callMinutes.limit - s.trial.callMinutes.used);
    return null;
  }

  /** Messenger hook: a counting AI text to a trial customer with none left is not sent. */
  private async allowText(customerId: number, purpose: string): Promise<boolean> {
    if (FREE_TEXT_PURPOSES.includes(purpose)) return true;
    try {
      const s = await this.state(customerId);
      if (!s.active) return false;
      if (s.limited !== 'TRIAL' || !s.trial) return true;
      return s.trial.texts.used < s.trial.texts.limit;
    } catch {
      return true;
    }
  }

  /**
   * New transactions arrived. A statement counts once (`statementId` unique); a re-read
   * never adds. Then the 80% / 100% / trial-over notices (once each).
   */
  async recordUsage(
    scope: BookScope,
    source: 'STATEMENT' | 'BANK_FEED',
    transactions: number,
    ref: { statementId?: number; plaidItemId?: number },
  ): Promise<void> {
    if (source === 'BANK_FEED' && transactions <= 0) return;
    try {
      await this.prisma.transactionUsage.createMany({
        data: [
          {
            customerId: scope.customerId,
            bookId: scope.bookId,
            month: monthOf(),
            source,
            statementId: ref.statementId ?? null,
            plaidItemId: ref.plaidItemId ?? null,
            transactions: Math.max(0, transactions),
          },
        ],
        skipDuplicates: true,
      });
    } catch (err) {
      this.logger.warn(
        `usage of customer ${scope.customerId} not recorded: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    this.forget(scope.customerId);
    await this.notices(scope.customerId).catch(() => undefined);
  }

  /** Has this statement been counted already (its first DONE read happened)? */
  async statementCounted(statementId: number): Promise<boolean> {
    const row = await this.prisma.transactionUsage.findUnique({
      where: { statementId },
      select: { id: true },
    });
    return !!row;
  }

  /** Once-a-month limit notices and the one trial-over notice. Never throws. */
  async notices(customerId: number): Promise<void> {
    const s = await this.state(customerId);
    const sub = await this.row(customerId);
    if (s.reason === 'TRIAL_USED' && !sub.trialEndedNotifiedAt) {
      const { count } = await this.prisma.customerSubscription.updateMany({
        where: { customerId, trialEndedNotifiedAt: null },
        data: { trialEndedNotifiedAt: new Date() },
      });
      if (count)
        await this.notify(
          customerId,
          'TRIAL_NOTICE',
          `Your CYG Finance free trial is over. Subscribe for ${await this.priceLabel()} a month to keep your books, the AI and your bank feeds going: ${this.baseUrl()}/dashboard/subscribe`,
          'Your free trial is over',
        );
      return;
    }
    const m = s.monthly;
    if (!m) return;
    if (m.reached && sub.limitMonth !== m.month) {
      const { count } = await this.prisma.customerSubscription.updateMany({
        where: { customerId, OR: [{ limitMonth: null }, { limitMonth: { not: m.month } }] },
        data: { limitMonth: m.month, warnedMonth: m.month },
      });
      if (count)
        await this.notify(
          customerId,
          'USAGE_LIMIT',
          `You reached your ${m.limit.toLocaleString('en-US')} transactions for this month on CYG Finance. New statements and bank transactions wait until ${new Date(m.resetsAt).toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: 'long', day: 'numeric' })}, then they are read by themselves.`,
          'Monthly transaction limit reached',
        );
    } else if (m.warn && !m.reached && sub.warnedMonth !== m.month) {
      const { count } = await this.prisma.customerSubscription.updateMany({
        where: { customerId, OR: [{ warnedMonth: null }, { warnedMonth: { not: m.month } }] },
        data: { warnedMonth: m.month },
      });
      if (count)
        await this.notify(
          customerId,
          'USAGE_LIMIT',
          `Heads up: you have used ${m.used.toLocaleString('en-US')} of your ${m.limit.toLocaleString('en-US')} transactions this month on CYG Finance.`,
          'Transactions this month',
        );
    }
  }

  /** Preferred contact: a text when they prefer a phone channel and have one, else email. */
  private async notify(
    customerId: number,
    purpose: 'USAGE_LIMIT' | 'TRIAL_NOTICE',
    text: string,
    subject: string,
  ): Promise<void> {
    const c = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { email: true, phoneE164: true, preferredContact: true, name: true },
    });
    if (!c) return;
    const wantsPhone = c.preferredContact !== 'EMAIL' && !!c.phoneE164;
    if ((wantsPhone || !c.email) && c.phoneE164) {
      const out = await this.messenger.send({
        channel: 'SMS',
        to: c.phoneE164,
        body: text,
        meta: { customerId, purpose },
      });
      if (out === 'sent') return;
    }
    if (c.email)
      await this.mail
        .send({
          to: c.email,
          subject,
          text: `${c.name ? `Hi ${c.name},\n\n` : ''}${text}\n\n— CYG Finance`,
          fromName: 'CYG Finance',
        })
        .catch((err: unknown) =>
          this.logger.warn(
            `${purpose} email to customer ${customerId} failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
  }

  baseUrl(): string {
    return (
      this.config.get<string>('PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '') ||
      'https://cygfinance.com'
    );
  }

  /** "$19.99" from the plan's Stripe price (set by `StripeBillingService`). */
  priceText: (() => Promise<string>) | null = null;
  private async priceLabel(): Promise<string> {
    return (await this.priceText?.().catch(() => null)) ?? '$19.99';
  }
}
