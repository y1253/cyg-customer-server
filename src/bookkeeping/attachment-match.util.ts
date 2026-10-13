import { cents } from './reconcile.util';

/** A parent transaction an attachment could belong to. */
export interface MatchCandidate {
  id: number;
  /** `postingDate ?? pendingDate`, YYYY-MM-DD; null when the row has neither. */
  date: string | null;
  amount: number;
  name: string | null;
  description: string;
  /** Totals (cents) of receipts already attached to it. */
  attachedTotals: number[];
}

export interface MatchQuery {
  /** RECEIPT money only goes out; a CHECK (or a voice note) may be either way. */
  kind: 'RECEIPT' | 'CHECK' | 'AUDIO' | 'OTHER';
  date: string | null;
  total: number | null;
}

/** How far the bank may post from the attachment date: 5 days before, 15 after. */
export const DAYS_BEFORE = 5;
export const DAYS_AFTER = 15;
/** A charge may be this much above the receipt (a tip added at the card machine). */
export const TIP_SLACK = 0.2;
/** How many candidates the AI sees at most. */
export const MAX_FOR_AI = 30;

const DAY_MS = 86_400_000;
const dayNumber = (iso: string): number | null => {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? Math.round(t / DAY_MS) : null;
};

/**
 * The transactions an attachment may belong to, best first (PURE).
 *
 * Code narrows; the AI only ever chooses among these. A row qualifies on sign (a receipt
 * is money out), amount (equal to the cent, or up to 20% more — a tip) and date (5 days
 * before to 15 after; no date on either side = any date). Exact amounts rank first,
 * then the nearest date; a row that already holds a receipt with this same total goes
 * last — it is most likely that receipt's twin, not this one's home.
 */
export function shortlist(
  q: MatchQuery,
  rows: readonly MatchCandidate[],
): MatchCandidate[] {
  const want = q.total != null && q.total > 0 ? cents(q.total) : null;
  const day = q.date ? dayNumber(q.date) : null;
  const scored: Array<{ row: MatchCandidate; rank: number[] }> = [];
  for (const row of rows) {
    if (q.kind === 'RECEIPT' && row.amount >= 0) continue;
    const have = Math.abs(cents(row.amount));
    if (have === 0) continue;
    let exact = 1;
    if (want != null) {
      if (have < want || have > Math.round(want * (1 + TIP_SLACK))) continue;
      exact = have === want ? 0 : 1;
    }
    let gap = 0;
    if (day != null && row.date) {
      const d = dayNumber(row.date);
      if (d != null) {
        if (d < day - DAYS_BEFORE || d > day + DAYS_AFTER) continue;
        gap = Math.abs(d - day);
      }
    }
    const twin = want != null && row.attachedTotals.includes(want) ? 1 : 0;
    scored.push({ row, rank: [twin, exact, gap, row.id] });
  }
  scored.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i++) {
      if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
    }
    return 0;
  });
  return scored.map((s) => s.row);
}

/**
 * The one transaction that needs no AI: exactly one candidate at the exact amount, not
 * already holding this receipt, posted within 3 days of it (or with no date to compare).
 * Anything less clear goes to the model.
 */
export function obviousMatch(
  q: MatchQuery,
  list: readonly MatchCandidate[],
): MatchCandidate | null {
  if (q.total == null || q.total <= 0) return null;
  const want = cents(q.total);
  const exact = list.filter(
    (r) =>
      Math.abs(cents(r.amount)) === want && !r.attachedTotals.includes(want),
  );
  if (exact.length !== 1) return null;
  const only = exact[0];
  if (!q.date || !only.date) return only;
  const a = dayNumber(q.date);
  const b = dayNumber(only.date);
  return a != null && b != null && Math.abs(a - b) <= 3 ? only : null;
}
