/**
 * The assistant's `list_statements` (step12h) — pure, so it is tested.
 *
 * Found 2026-10-27 (customer 43, a call about an American Express statement): a book with
 * 89 statements came back longer than the tool-result cap, the statements of one account
 * fell off the end, and the agent told the caller they did not exist, then guessed ids.
 * Now the answer always starts with ONE line per account (so every account is seen even
 * when rows are cut), and the rows can be narrowed by account, period and status.
 */

export interface StatementRow {
  id: number;
  label: string;
  status: string;
  accountName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  transactionCount: number;
  error: string | null;
  createdAt: Date | string;
}

export interface StatementQuery {
  /** Account name, case-insensitive; every word must appear ("amex 1004", "american express"). */
  account?: string | null;
  /** YYYY-MM-DD: statements whose period overlaps from–to. */
  from?: string | null;
  to?: string | null;
  status?: string | null;
  limit?: number | null;
}

export const DEFAULT_STATEMENT_LIMIT = 40;
export const MAX_STATEMENT_LIMIT = 100;
export const NOT_SORTED = 'Not sorted yet';

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** "AMEX" is how people say American Express. */
const ALIASES: Record<string, string> = { amex: 'american express' };

function accountMatches(accountName: string | null, query: string): boolean {
  const name = norm(accountName ?? NOT_SORTED);
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ALIASES[w] ?? w)
    .every((w) => name.includes(w));
}

function overlaps(r: StatementRow, from: string | null, to: string | null) {
  const start = day(r.periodStart) ?? day(r.periodEnd);
  const end = day(r.periodEnd) ?? day(r.periodStart);
  if (!start || !end) return true; // period not read: never hide it
  if (from && end < from) return false;
  if (to && start > to) return false;
  return true;
}

export function listStatements(rows: StatementRow[], q: StatementQuery = {}) {
  // One line per account over the WHOLE book, before any filter.
  const byAccount = new Map<
    string,
    {
      account: string;
      statements: number;
      latestPeriodEnd: string | null;
      notDone: number;
    }
  >();
  for (const r of rows) {
    const account = r.accountName ?? NOT_SORTED;
    const a = byAccount.get(account) ?? {
      account,
      statements: 0,
      latestPeriodEnd: null,
      notDone: 0,
    };
    a.statements += 1;
    const end = day(r.periodEnd);
    if (end && (!a.latestPeriodEnd || end > a.latestPeriodEnd))
      a.latestPeriodEnd = end;
    if (r.status !== 'DONE') a.notDone += 1;
    byAccount.set(account, a);
  }

  const status = q.status?.trim().toUpperCase() || null;
  const matched = rows
    .filter(
      (r) => !q.account?.trim() || accountMatches(r.accountName, q.account),
    )
    .filter((r) => !status || r.status === status)
    .filter((r) => overlaps(r, q.from ?? null, q.to ?? null))
    // Newest period first; unread ones (no period) by upload time, first.
    .sort((a, b) => {
      const ka = day(a.periodEnd) ?? '9999';
      const kb = day(b.periodEnd) ?? '9999';
      return kb.localeCompare(ka) || b.id - a.id;
    });
  const limit = Math.min(
    Math.max(1, Math.floor(q.limit ?? DEFAULT_STATEMENT_LIMIT)),
    MAX_STATEMENT_LIMIT,
  );

  return {
    total: rows.length,
    accounts: [...byAccount.values()].sort((a, b) =>
      a.account.localeCompare(b.account),
    ),
    matched: matched.length,
    ...(matched.length > limit && {
      note: `Showing ${limit} of ${matched.length} — filter by account, period or status to see the rest.`,
    }),
    statements: matched.slice(0, limit).map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      account: r.accountName,
      periodStart: day(r.periodStart),
      periodEnd: day(r.periodEnd),
      transactions: r.transactionCount,
      ...(r.error && { error: r.error }),
    })),
  };
}
