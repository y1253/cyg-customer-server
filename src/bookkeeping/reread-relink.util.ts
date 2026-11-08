/**
 * step2 (2026-11-08): a statement that was already read (DONE) can be read again with the
 * customer's note. Its rows are replaced, which drops every receipt off them (the FK is
 * SET NULL) — so the receipts are put back on the new row that is the same transaction:
 * same amount, same day and same description, else the ONE row of that amount and day.
 */
export interface LinkedRow {
  attachmentId: number;
  amountCents: number;
  /** YYYY-MM-DD (posted, else pending), or null. */
  day: string | null;
  description: string;
}

export interface FreshRow {
  id: number;
  amountCents: number;
  day: string | null;
  description: string;
}

/** attachmentId → the new transaction id; attachments with no clear match are left out. */
export function relinkPlan(
  linked: readonly LinkedRow[],
  fresh: readonly FreshRow[],
): Map<number, number> {
  const out = new Map<number, number>();
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const pick = (a: LinkedRow, sameText: boolean) => {
    const hits = fresh.filter(
      (r) =>
        r.amountCents === a.amountCents &&
        r.day === a.day &&
        (!sameText || norm(r.description) === norm(a.description)),
    );
    // Two identical rows (two $5 coffees the same day) are the same transaction to a
    // receipt — the first is as good as the old link was. By amount and day alone, only
    // a single hit is trusted.
    if (sameText) return hits.length ? hits[0].id : null;
    return hits.length === 1 ? hits[0].id : null;
  };
  for (const a of linked) {
    const id = pick(a, true) ?? pick(a, false);
    if (id !== null) out.set(a.attachmentId, id);
  }
  return out;
}
