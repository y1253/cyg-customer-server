/**
 * 2026-11-16 — the order a statement's rows run in, decided ONE way everywhere.
 *
 * Some banks print the newest transaction first (Wise: page 1's top row is the latest, page
 * 2's bottom row the oldest). Rows used to be stored top to bottom, and each check guessed
 * the order on its own (first vs last date), so a running balance that ends at the TOP of
 * page 1 was compared with the wrong row (Madam recovery's Wise #340 / #336). Rows are now
 * saved oldest first (`chronological`), and the checks walk them by date. Pure.
 */

export interface OrderRow {
  postingDate?: string | null;
  amount?: number | null;
  balanceAfter?: number | null;
}

const cents = (n: number) => Math.round(n * 100);

/**
 * True when the rows run newest first. The dates decide: the steps between consecutive dated
 * rows that go DOWN against those that go UP (not just the first vs the last row, which tie
 * on a statement that starts and ends on the same day). On a tie (one day, no dates) the
 * running balance decides: the links that hold read forward (`bal[i] = bal[i-1] ± amt[i]`)
 * against those that hold read backward (`bal[i] = bal[i+1] ± amt[i]`). Either sign counts,
 * like `reconcile` (a card prints the balance owed). Still a tie = printed order.
 */
export function runsNewestFirst(rows: ReadonlyArray<OrderRow>): boolean {
  const dates = rows
    .map((r) => r.postingDate ?? null)
    .filter((d): d is string => !!d);
  let down = 0;
  let up = 0;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] < dates[i - 1]) down++;
    else if (dates[i] > dates[i - 1]) up++;
  }
  if (down !== up) return down > up;
  let forward = 0;
  let backward = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (a.balanceAfter == null || b.balanceAfter == null) continue;
    const diff = cents(b.balanceAfter) - cents(a.balanceAfter);
    // Forward: row b moved the balance from a's to b's.
    if (
      b.amount != null &&
      Math.abs(diff) === Math.abs(cents(b.amount)) &&
      diff !== 0
    )
      forward++;
    // Backward: row a moved the balance from b's to a's.
    if (
      a.amount != null &&
      Math.abs(diff) === Math.abs(cents(a.amount)) &&
      diff !== 0
    )
      backward++;
  }
  return backward > forward;
}

/**
 * The rows by date, oldest first. A newest-first statement is read from its last row up, so
 * rows of the same day keep the bank's order the right way round; then a STABLE sort by date
 * puts any section printed the other way in place (BMO #146: page 1 newest first, the rest
 * oldest first). A row with no date stays after the row before it. Already in order = the
 * same array.
 */
export function chronological<T extends OrderRow>(rows: T[]): T[] {
  const base = runsNewestFirst(rows) ? [...rows].reverse() : rows;
  const first = base.find((r) => r.postingDate)?.postingDate ?? '';
  let carried = first;
  const keyed = base.map((row, i) => {
    if (row.postingDate) carried = row.postingDate;
    return { row, i, date: carried };
  });
  keyed.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i,
  );
  const sorted = keyed.map((k) => k.row);
  return sorted.every((r, i) => r === rows[i]) ? rows : sorted;
}

/**
 * How the printed balance moves with a row, read off the chain itself (rows oldest first):
 * +1 = balance + amount (a bank account), −1 = balance − amount (a card printing what is
 * owed). `card` breaks a tie.
 */
export function balanceDirection(
  rows: ReadonlyArray<OrderRow>,
  card = false,
): 1 | -1 {
  let plus = 0;
  let minus = 0;
  let prev: number | null = null;
  for (const r of rows) {
    if (r.balanceAfter == null) {
      prev = null;
      continue;
    }
    if (prev !== null && r.amount != null) {
      const diff = cents(r.balanceAfter) - prev;
      const amt = cents(r.amount);
      if (diff === amt) plus++;
      if (diff === -amt) minus++;
    }
    prev = cents(r.balanceAfter);
  }
  if (plus !== minus) return plus > minus ? 1 : -1;
  return card ? -1 : 1;
}
