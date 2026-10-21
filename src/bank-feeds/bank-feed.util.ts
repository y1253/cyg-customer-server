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

  const covered = input.covered ?? [];
  return plans.filter(
    (p) =>
      !covered.some((c) =>
        overlaps({ start: p.periodStart, end: p.periodEnd }, c),
      ),
  );
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
