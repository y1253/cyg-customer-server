/**
 * Transaction alerts (2026-10-25): one message per Plaid update listing the new transactions
 * and the category each was filed under. Pure, so the channel rule and the wording are tested
 * on their own.
 */

import { UNCATEGORIZED } from '../bookkeeping/chart-of-accounts';

export type AlertChannel = 'SMS' | 'WHATSAPP' | 'EMAIL';

/** A new row is only alerted when it posted this recently (late history never is). */
export const ALERT_MAX_AGE_DAYS = 7;
/** Lines listed in one message; the rest are counted. */
export const ALERT_MAX_LINES = 10;

/**
 * The channel an alert goes on (user's decisions, 2026-10-25): the preferred contact ONLY, no
 * fallback — except "Phone call", which is texted (no call per transaction). Nothing saved =
 * still sent: a text when they have a phone and texts are set up, else an email.
 */
export function alertChannel(c: {
  preferred: string | null;
  phone: string | null;
  email: string | null;
  smsConfigured: boolean;
}): AlertChannel | null {
  const canText = Boolean(c.phone) && c.smsConfigured;
  switch (c.preferred) {
    case 'EMAIL':
      return c.email ? 'EMAIL' : null;
    case 'WHATSAPP':
      return c.phone ? 'WHATSAPP' : null;
    case 'SMS':
    case 'CALL':
      return canText ? 'SMS' : null;
    default:
      return canText ? 'SMS' : c.email ? 'EMAIL' : null;
  }
}

/** True when a posted date (YYYY-MM-DD) is recent enough to alert. */
export function recentEnough(date: string, today: string): boolean {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`);
  return ms <= ALERT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

export interface AlertRow {
  /** The folder ("TD Canada Trust 6074"). */
  account: string;
  /** YYYY-MM-DD. */
  date: string;
  /** The ledger row's name, else the bank's description. */
  label: string;
  /** Our sign: > 0 money in. */
  amount: number;
  category: string;
}

const money = (n: number): string =>
  `${n < 0 ? '−' : '+'}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const shortDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

/**
 * The message, e.g.
 *   New transactions in TD Canada Trust 6074:
 *   • Oct 24 · Tim Hortons · −$4.50 → Meals and Entertainment
 *   Reply to change a category.
 * Grouped by account, oldest first, at most `ALERT_MAX_LINES` lines. `book` is named only
 * when the customer has more than one.
 */
export function alertText(input: {
  book: string | null;
  rows: readonly AlertRow[];
}): string {
  const rows = [...input.rows].sort(
    (a, b) =>
      a.account.localeCompare(b.account) || a.date.localeCompare(b.date),
  );
  const accounts = [...new Set(rows.map((r) => r.account))];
  const where = input.book ? ` (${input.book})` : '';
  const lines: string[] = [];
  let shown = 0;
  for (const account of accounts) {
    const mine = rows.filter((r) => r.account === account);
    const room = ALERT_MAX_LINES - shown;
    if (room <= 0) break;
    const one = rows.length === 1;
    lines.push(
      `${one ? 'New transaction' : 'New transactions'} in ${account}${where}:`,
    );
    for (const r of mine.slice(0, room)) {
      const category =
        r.category === UNCATEGORIZED
          ? `${UNCATEGORIZED} (reply with what it was)`
          : r.category;
      lines.push(
        `• ${shortDate(r.date)} · ${r.label} · ${money(r.amount)} → ${category}`,
      );
      shown++;
    }
  }
  const more = rows.length - shown;
  if (more > 0) lines.push(`…and ${more} more on cygfinance.com`);
  lines.push(
    rows.length === 1
      ? 'Reply to change the category.'
      : 'Reply to change a category.',
  );
  return lines.join('\n');
}

export const ALERT_EMAIL_SUBJECT = 'New transactions in your books';
