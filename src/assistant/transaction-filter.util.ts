/**
 * The assistant's "search my transactions" (step11) — pure, so it is tested. Runs over the
 * ledger the customer sees (`BookkeepingService.transactions`), so names and categories
 * already include their renames and splits.
 */

export interface LedgerRow {
  id: number;
  kind?: 'opening' | 'tax' | 'split' | 'fx';
  postingDate: string | null;
  pendingDate: string | null;
  description: string;
  name: string | null;
  itemName?: string | null;
  amount: number;
  offsetAccount: string;
  statementLabel: string;
  attachments?: unknown[];
}

export interface TransactionQuery {
  /** YYYY-MM-DD, inclusive. */
  from?: string | null;
  to?: string | null;
  /** Payee name, case-insensitive substring. */
  name?: string | null;
  /** Category (offset account), case-insensitive exact or substring. */
  category?: string | null;
  /** Free text over the name, description and item. */
  text?: string | null;
  /** Absolute amount bounds, dollars. */
  minAmount?: number | null;
  maxAmount?: number | null;
  /** 'in' = money in, 'out' = money out. */
  direction?: 'in' | 'out' | null;
  limit?: number | null;
}

export interface FoundRow {
  id: number;
  split: boolean;
  date: string | null;
  name: string | null;
  description: string;
  amount: number;
  category: string;
  statement: string;
  attachments: number;
}

export const MAX_ROWS = 200;

const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const has = (hay: string | null | undefined, needle: string) =>
  !!hay && hay.toLowerCase().includes(needle);

/**
 * Real transactions and splits that match every filter given, newest first, plus the count
 * and the total of ALL matches (so "how much did I spend at Costco" is right even past the
 * row limit). Starting balances, tax lines and FX revaluations are not transactions.
 */
export function filterTransactions(
  rows: readonly LedgerRow[],
  q: TransactionQuery,
): { count: number; total: number; rows: FoundRow[] } {
  const name = q.name?.trim().toLowerCase();
  const category = q.category?.trim().toLowerCase();
  const text = q.text?.trim().toLowerCase();
  const matches = rows.filter((r) => {
    if (r.kind && r.kind !== 'split') return false;
    const date = dayOf(r.postingDate ?? r.pendingDate);
    if (q.from && (!date || date < q.from)) return false;
    if (q.to && (!date || date > q.to)) return false;
    if (name && !has(r.name, name)) return false;
    if (category && !has(r.offsetAccount, category)) return false;
    if (
      text &&
      !has(r.name, text) &&
      !has(r.description, text) &&
      !has(r.itemName, text)
    ) {
      return false;
    }
    const abs = Math.abs(r.amount);
    if (q.minAmount != null && abs < q.minAmount) return false;
    if (q.maxAmount != null && abs > q.maxAmount) return false;
    if (q.direction === 'in' && r.amount < 0) return false;
    if (q.direction === 'out' && r.amount >= 0) return false;
    return true;
  });
  const sorted = [...matches].sort((a, b) =>
    (dayOf(b.postingDate ?? b.pendingDate) ?? '').localeCompare(
      dayOf(a.postingDate ?? a.pendingDate) ?? '',
    ),
  );
  const limit = Math.min(Math.max(q.limit ?? 50, 1), MAX_ROWS);
  const total =
    Math.round(matches.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  return {
    count: matches.length,
    total,
    rows: sorted.slice(0, limit).map((r) => ({
      id: r.id,
      split: r.kind === 'split',
      date: dayOf(r.postingDate ?? r.pendingDate),
      name: r.itemName ?? r.name,
      description: r.description,
      amount: r.amount,
      category: r.offsetAccount,
      statement: r.statementLabel,
      attachments: r.attachments?.length ?? 0,
    })),
  };
}
