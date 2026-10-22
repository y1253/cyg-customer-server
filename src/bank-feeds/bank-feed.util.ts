/**
 * Bank feeds (step11): a connected account's transactions → one statement per calendar
 * month. Pure, so the balance walk and the month split are tested on their own.
 *
 * Plaid gives the account's CURRENT balance and its transactions, never a statement. Each
 * month's balances are therefore walked BACKWARDS from today's balance:
 *  - a bank account (an asset): opening = closing − net of the month;
 *  - a credit card, whose balance is the amount OWED (our CREDIT_CARD convention, like a
 *    printed card statement): a purchase (negative here) raises what is owed, so
 *    opening = closing + net.
 * The months then chain to the cent, so the ledger shows ONE starting balance per account.
 */

/** One posted transaction of the feed, in OUR sign: > 0 money IN, < 0 money OUT. */
export interface FeedTxn {
  id: string;
  /** YYYY-MM-DD, the posted date. */
  date: string;
  cents: number;
}

export interface MonthPlan {
  /** YYYY-MM-DD; the first month starts at its first transaction (history is cut there). */
  periodStart: string;
  /** YYYY-MM-DD; the current month ends today and grows. */
  periodEnd: string;
  /** null when Plaid gave no current balance. */
  openingCents: number | null;
  closingCents: number | null;
  /** The month's transactions, oldest first. */
  txnIds: string[];
}

export interface PlanInput {
  kind: 'BANK' | 'CREDIT_CARD';
  /** Plaid `balances.current` in cents (a card: the amount owed), or null. */
  currentCents: number | null;
  /** YYYY-MM-DD — the day the balance is as of. */
  today: string;
  txns: readonly FeedTxn[];
  /**
   * Periods already covered by a statement the customer UPLOADED for this account. Uploads
   * win: a month overlapping one gets no feed statement (its balances still count in the
   * walk, so the other months stay right).
   */
  covered?: ReadonlyArray<{ start: string; end: string }>;
  /**
   * YYYY-MM-DD — the first day the customer wants in the books (step12). Earlier months are
   * left out and the month it falls in starts that day, opening at that day's balance (the
   * walk still counts every transaction, so the balances stay right).
   */
  startDate?: string | null;
}

/** Plaid's amount (+ = money out, a decimal) → our cents (+ = money in). */
export function feedCents(plaidAmount: number | string): number {
  return -Math.round(Number(plaidAmount) * 100);
}

/** "2026-10-14" → "2026-10". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, '0')}`;
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function overlaps(
  a: { start: string; end: string },
  b: { start: string; end: string },
) {
  return a.start <= b.end && a.end >= b.start;
}

/** The feed's month statements, oldest first. No transactions → no statements. */
export function planMonths(input: PlanInput): MonthPlan[] {
  const txns = [...input.txns].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  if (!txns.length) return [];

  const lastDate =
    txns[txns.length - 1].date > input.today
      ? txns[txns.length - 1].date
      : input.today;
  const months: string[] = [];
  for (let m = monthOf(txns[0].date); m <= monthOf(lastDate); m = nextMonth(m))
    months.push(m);

  const byMonth = new Map<string, FeedTxn[]>(months.map((m) => [m, []]));
  for (const t of txns) byMonth.get(monthOf(t.date))!.push(t);

  // Walk backwards from the current balance.
  const plans: MonthPlan[] = [];
  let closing = input.currentCents;
  for (let i = months.length - 1; i >= 0; i--) {
    const month = months[i];
    const rows = byMonth.get(month)!;
    const net = rows.reduce((s, t) => s + t.cents, 0);
    const opening =
      closing === null
        ? null
        : input.kind === 'CREDIT_CARD'
          ? closing + net
          : closing - net;
    plans.push({
      periodStart: i === 0 ? txns[0].date : `${month}-01`,
      periodEnd: i === months.length - 1 ? lastDate : lastDayOf(month),
      openingCents: opening,
      closingCents: closing,
      txnIds: rows.map((t) => t.id),
    });
    closing = opening;
  }
  plans.reverse();
  const kept = input.startDate
    ? fromStartDate(plans, txns, input.kind, input.startDate)
    : plans;

  const covered = input.covered ?? [];
  return kept.filter(
    (p) =>
      !covered.some((c) =>
        overlaps({ start: p.periodStart, end: p.periodEnd }, c),
      ),
  );
}

/** The plans from `start` on; the month it falls in is cut at that day. */
function fromStartDate(
  plans: MonthPlan[],
  txns: readonly FeedTxn[],
  kind: PlanInput['kind'],
  start: string,
): MonthPlan[] {
  const dateOf = new Map(txns.map((t) => [t.id, t]));
  const out: MonthPlan[] = [];
  for (const p of plans) {
    if (p.periodEnd < start) continue;
    if (p.periodStart >= start) {
      out.push(p);
      continue;
    }
    const txnIds = p.txnIds.filter((id) => dateOf.get(id)!.date >= start);
    const net = txnIds.reduce((s, id) => s + dateOf.get(id)!.cents, 0);
    const opening =
      p.closingCents === null
        ? null
        : kind === 'CREDIT_CARD'
          ? p.closingCents + net
          : p.closingCents - net;
    out.push({ ...p, periodStart: start, openingCents: opening, txnIds });
  }
  return out;
}

/** "Mar 2026" for a month statement's file name. */
export function monthLabel(periodStart: string): string {
  const [y, m] = periodStart.split('-').map(Number);
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  return `${name} ${y}`;
}

/** BANK | CREDIT_CARD from Plaid's account type. A line of credit is owed like a card. */
export function kindOfPlaidType(type: string): 'BANK' | 'CREDIT_CARD' {
  return type === 'credit' ? 'CREDIT_CARD' : 'BANK';
}

/** The folder name for a new account: "<bank> <last 4>", like a read statement's. */
export function defaultAccountName(
  institution: string | null,
  account: { name: string; mask: string | null },
): string {
  const bank = institution?.trim() || account.name.trim() || 'Bank';
  return (
    account.mask ? `${bank} ${account.mask}` : `${bank} ${account.name}`
  ).slice(0, 191);
}

/** Today as YYYY-MM-DD in UTC. */
export function isoDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** `/item/get` → `status.transactions`: Plaid's own tries at the bank. */
export interface PlaidUpdateStatus {
  last_successful_update?: string | null;
  last_failed_update?: string | null;
}

/** What Plaid says about the bank (`/institutions/get_by_id` with `include_status`). */
export interface BankHealth {
  /** `status.transactions_updates.status`: HEALTHY | DEGRADED | DOWN (often absent). */
  updates?: string | null;
  /** Open `status.health_incidents` (no `end_date`), e.g. TD's overnight-only updates. */
  openIncidents?: number;
}

/**
 * Why a connection's history is not in yet, in the customer's words — or null when it is
 * simply still coming. step12: a TD connection made in the afternoon stayed NOT_READY with
 * "Bringing in…" for hours — TD lets Plaid collect transactions only 4am–11am UTC (an open
 * Plaid incident since 2021), so the first ones come the next morning.
 */
export function bankDelayNote(
  institutionName: string | null,
  updates: PlaidUpdateStatus | null | undefined,
  health: BankHealth | null | undefined,
): string | null {
  if (!updates?.last_failed_update || updates.last_successful_update) {
    return null;
  }
  const bank = institutionName?.trim() || 'your bank';
  if (health?.updates === 'DOWN' || health?.updates === 'DEGRADED') {
    return (
      `${bank} isn't sending transactions to Plaid right now — a problem on the bank's ` +
      'side. We keep checking every few minutes and bring them in automatically once it is back.'
    );
  }
  if (health?.openIncidents) {
    return (
      `${bank} only lets Plaid collect transactions at certain hours (usually overnight), so ` +
      'your history can take until tomorrow morning. We keep checking and bring it in automatically.'
    );
  }
  return `Plaid couldn't get your transactions from ${bank} yet. We keep trying every few minutes.`;
}

/**
 * Hours (UTC, [from, to)) a bank lets Plaid collect transactions, by Plaid institution id.
 * A `/transactions/refresh` outside them is wasted. TD (`ins_42`): Plaid's own standing
 * incident since 2021 — "only allows Transaction updates daily between 4am-11am UTC".
 */
export const REFRESH_WINDOWS_UTC: Readonly<
  Record<string, readonly [number, number]>
> = { ins_42: [4, 11] };

/** An automatic refresh of a stuck connection is asked for at most this often. */
export const AUTO_REFRESH_EVERY_MS = 60 * 60 * 1000;
/** "Refresh now" may ask Plaid again this soon (each refresh is billed). */
export const MANUAL_REFRESH_EVERY_MS = 5 * 60 * 1000;

export type RefreshDecision =
  | 'ok'
  | 'outside-window'
  | 'too-soon'
  | 'not-stuck';

/**
 * Whether to ask Plaid to go to the bank again now (`/transactions/refresh`). step12: Plaid's
 * one scheduled pull from TD failed (2026-10-22 09:13Z) and nothing asked it to try again —
 * "Refresh now" only re-read Plaid's cache. Automatic = only while Plaid's tries have failed
 * with no success, at most hourly; manual ("Refresh now") skips both, never the bank's window.
 */
export function shouldRequestRefresh(p: {
  now: Date;
  lastRefreshAt: Date | null;
  institutionId: string | null;
  failedWithoutSuccess: boolean;
  manual: boolean;
}): RefreshDecision {
  const window = p.institutionId ? REFRESH_WINDOWS_UTC[p.institutionId] : null;
  if (window) {
    const hour = p.now.getUTCHours();
    if (hour < window[0] || hour >= window[1]) return 'outside-window';
  }
  if (!p.manual && !p.failedWithoutSuccess) return 'not-stuck';
  const every = p.manual ? MANUAL_REFRESH_EVERY_MS : AUTO_REFRESH_EVERY_MS;
  if (p.lastRefreshAt && p.now.getTime() - p.lastRefreshAt.getTime() < every) {
    return 'too-soon';
  }
  return 'ok';
}

/** "Refresh now" outside the bank's hours: when it will be asked, in Eastern time. */
export function refreshWindowNote(
  institutionName: string | null,
  institutionId: string | null,
  now: Date = new Date(),
): string | null {
  const window = institutionId ? REFRESH_WINDOWS_UTC[institutionId] : null;
  if (!window) return null;
  const at = (h: number) => {
    const d = new Date(now);
    d.setUTCHours(h, 0, 0, 0);
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Toronto',
    });
  };
  const bank = institutionName?.trim() || 'Your bank';
  return (
    `${bank} only lets Plaid collect transactions between ${at(window[0])} and ` +
    `${at(window[1])} Eastern time. We'll ask it again then, automatically.`
  );
}
