import type { SubscriptionStatus } from '@prisma/client';

/**
 * Who may use the app (2026-11-25, the monthly subscription). Pure, so the guard, the AI
 * channels and the views all agree.
 *
 * Order: a free promo or a paid Stripe plan (PAST_DUE included — Stripe is still retrying
 * the card: the grace period) → the free trial for an account that never paid and has
 * allowances left → locked.
 */
export type AccessReason =
  | 'PAID'
  | 'PAST_DUE'
  | 'FREE'
  | 'TRIAL'
  | 'TRIAL_USED'
  | 'UNPAID'
  | 'ENDED'
  | 'NONE';

export interface Access {
  active: boolean;
  reason: AccessReason;
  /** The monthly transaction limit applies (paid / free promo); the trial has its own. */
  limited: 'MONTHLY' | 'TRIAL' | null;
}

export interface SubscriptionLike {
  status: SubscriptionStatus;
  everPaid: boolean;
  freeForever: boolean;
  freeUntil: Date | null;
}

/** What the free trial gives, and what was used of it. */
export interface TrialAllowance {
  transactions: number;
  texts: number;
  callMinutes: number;
}

export type TrialItem = keyof TrialAllowance;
export const TRIAL_ITEMS: readonly TrialItem[] = [
  'transactions',
  'texts',
  'callMinutes',
];

/** Stripe statuses that keep the app open. PAST_DUE = the retries (grace period). */
const PAID_OPEN: readonly SubscriptionStatus[] = [
  'ACTIVE',
  'TRIALING',
  'PAST_DUE',
];

/** The allowances used up (empty = the trial is still on). */
export function trialUsedUp(
  allowance: TrialAllowance,
  used: TrialAllowance,
): TrialItem[] {
  return TRIAL_ITEMS.filter((k) => used[k] >= allowance[k]);
}

export function accessOf(
  sub: SubscriptionLike | null,
  trial: { allowance: TrialAllowance; used: TrialAllowance } | null,
  now = new Date(),
): Access {
  const s: SubscriptionLike = sub ?? {
    status: 'NONE',
    everPaid: false,
    freeForever: false,
    freeUntil: null,
  };
  if (s.freeForever || (s.freeUntil && s.freeUntil.getTime() > now.getTime()))
    return { active: true, reason: 'FREE', limited: 'MONTHLY' };
  if (PAID_OPEN.includes(s.status))
    return {
      active: true,
      reason: s.status === 'PAST_DUE' ? 'PAST_DUE' : 'PAID',
      limited: 'MONTHLY',
    };
  if (!s.everPaid && trial) {
    if (!trialUsedUp(trial.allowance, trial.used).length)
      return { active: true, reason: 'TRIAL', limited: 'TRIAL' };
    return { active: false, reason: 'TRIAL_USED', limited: null };
  }
  if (s.status === 'UNPAID') return { active: false, reason: 'UNPAID', limited: null };
  if (s.everPaid || s.freeUntil || s.status !== 'NONE')
    return { active: false, reason: 'ENDED', limited: null };
  return { active: false, reason: 'NONE', limited: null };
}

/** Stripe's subscription status → ours. */
export function statusFromStripe(status: string): SubscriptionStatus {
  const map: Record<string, SubscriptionStatus> = {
    incomplete: 'INCOMPLETE',
    incomplete_expired: 'INCOMPLETE_EXPIRED',
    trialing: 'TRIALING',
    active: 'ACTIVE',
    past_due: 'PAST_DUE',
    unpaid: 'UNPAID',
    canceled: 'CANCELED',
    paused: 'PAUSED',
  };
  return map[status] ?? 'NONE';
}

const ZONE = 'America/Toronto';

/** "2026-11" — the calendar month of `at` in Toronto (the limit's month). */
export function monthOf(at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(at);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return `${y}-${m}`;
}

/** The instant the NEXT month starts in Toronto (when the limit resets). */
export function nextMonthStart(at = new Date()): Date {
  const [y, m] = monthOf(at).split('-').map(Number);
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  // Midnight Toronto = 04:00 or 05:00 UTC; find the right one.
  for (const h of [4, 5]) {
    const d = new Date(Date.UTC(year, month - 1, 1, h));
    if (monthOf(d) === `${year}-${String(month).padStart(2, '0')}`) {
      const before = new Date(d.getTime() - 3_600_000);
      if (monthOf(before) !== monthOf(d)) return d;
    }
  }
  return new Date(Date.UTC(year, month - 1, 1, 5));
}

/** Transactions left this month (never negative), and whether to warn. */
export function monthlyUsage(
  used: number,
  limit: number,
  warnPercent: number,
): { remaining: number; warn: boolean; reached: boolean } {
  const remaining = Math.max(0, limit - used);
  return {
    remaining,
    reached: remaining <= 0,
    warn: limit > 0 && used * 100 >= limit * warnPercent,
  };
}

/** `freeUntil` after redeeming `months` more months (counted from today or the old end). */
export function freeUntilAfter(
  current: Date | null,
  months: number,
  now = new Date(),
): Date {
  const from =
    current && current.getTime() > now.getTime() ? current : now;
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** CommMessage purposes that do NOT count against the trial's texts. */
export const FREE_TEXT_PURPOSES: readonly string[] = [
  'LOGIN_CODE',
  'USAGE_LIMIT',
  'TRIAL_NOTICE',
  'FEATURE_DONE',
  'SALES_TEXT',
  'SIGNUP_OFFER',
  'SUBSCRIBE_LINK',
  'INTAKE',
];

/** Customer-readable "why is it locked" line. */
export function lockedText(reason: AccessReason, usedUp: TrialItem[] = []): string {
  const names: Record<TrialItem, string> = {
    transactions: 'transactions',
    texts: 'AI texts',
    callMinutes: 'AI call minutes',
  };
  switch (reason) {
    case 'TRIAL_USED':
      return `Your free trial is over (you used all its ${usedUp.map((k) => names[k]).join(' and ') || 'allowance'}). Subscribe to keep going.`;
    case 'UNPAID':
      return 'Your last payment did not go through. Update your card to keep going.';
    case 'ENDED':
      return 'Your plan has ended. Subscribe to keep going.';
    default:
      return 'Subscribe to use CYG Finance.';
  }
}
