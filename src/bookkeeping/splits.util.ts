import { cents } from './reconcile.util';

/**
 * Hand-made splits. A split is a child `BankTransaction` (`splitOfId` = its parent) with
 * its own name, category and taxes. The parent keeps the amount the bank printed — the
 * statement still reconciles — and every reader (ledger, reports, export, tax tagging)
 * uses what is LEFT of it after its splits (`remainderOf`).
 */

/** Σ of each parent's split amounts, in cents, keyed by the parent id. */
export function splitTotals(
  rows: ReadonlyArray<{ splitOfId: number | null; amount: number }>,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) {
    if (r.splitOfId == null) continue;
    out.set(r.splitOfId, (out.get(r.splitOfId) ?? 0) + cents(r.amount));
  }
  return out;
}

/** A parent's amount after its splits; a split (or an unsplit row) is returned as is. */
export function remainderOf(
  row: { id: number; splitOfId: number | null; amount: number },
  totals: ReadonlyMap<number, number>,
): number {
  if (row.splitOfId != null) return row.amount;
  const taken = totals.get(row.id);
  return taken ? (cents(row.amount) - taken) / 100 : row.amount;
}

/**
 * Why a set of split amounts (positive, as the customer types them) cannot be taken out
 * of a bank amount — or null when it can. They must be real amounts in cents and may not
 * add up to MORE than the transaction (all of it is fine: nothing is left on the parent).
 * step2 (2026-11-15): $0.00 is allowed — a new split starts at 0 and is filled in place.
 */
export function splitProblem(
  parentAmount: number,
  amounts: readonly number[],
): string | null {
  if (parentAmount === 0) return 'A $0.00 transaction cannot be split';
  for (const a of amounts) {
    if (!Number.isFinite(a) || a < 0)
      return 'A split amount cannot be negative';
    if (Math.abs(cents(a) - a * 100) > 1e-6)
      return 'Amounts can have at most 2 decimals';
  }
  const total = amounts.reduce((n, a) => n + cents(a), 0);
  if (total > Math.abs(cents(parentAmount))) {
    return (
      `The splits add up to $${(total / 100).toFixed(2)}, more than the ` +
      `transaction's $${Math.abs(parentAmount).toFixed(2)}`
    );
  }
  return null;
}

/** A split amount the customer typed (positive), signed like its parent. */
export function signedLike(parentAmount: number, amount: number): number {
  return parentAmount < 0 ? -Math.abs(amount) : Math.abs(amount);
}

// ---- step9 (2026-11-17): splits of splits ----

/** One split of a family as the nesting helpers see it. */
export interface FamilySplit {
  id: number;
  /** The split it was cut from; null = cut from the transaction itself. */
  parentSplitId: number | null;
}

/** The ids of `id` and every split cut from it, at any depth (`id` first). */
export function subtreeIds(rows: readonly FamilySplit[], id: number): number[] {
  const children = new Map<number, number[]>();
  for (const r of rows) {
    if (r.parentSplitId == null) continue;
    children.set(r.parentSplitId, [
      ...(children.get(r.parentSplitId) ?? []),
      r.id,
    ]);
  }
  const out: number[] = [];
  const seen = new Set<number>();
  const walk = (at: number) => {
    if (seen.has(at)) return;
    seen.add(at);
    out.push(at);
    for (const c of children.get(at) ?? []) walk(c);
  };
  walk(id);
  return out;
}

/**
 * A family's splits in reading order: each split straight after the one it was cut from
 * (depth-first, siblings by id), with its depth (0 = cut from the transaction). A split
 * whose parent is missing counts as cut from the transaction.
 */
export function splitTree<T extends FamilySplit>(
  rows: readonly T[],
): Array<{ row: T; depth: number }> {
  const ids = new Set(rows.map((r) => r.id));
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const children = new Map<number | null, T[]>();
  for (const r of sorted) {
    const at =
      r.parentSplitId != null && ids.has(r.parentSplitId)
        ? r.parentSplitId
        : null;
    children.set(at, [...(children.get(at) ?? []), r]);
  }
  const out: Array<{ row: T; depth: number }> = [];
  const seen = new Set<number>();
  const walk = (at: number | null, depth: number) => {
    for (const r of children.get(at) ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ row: r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * Why a split cut from another split cannot be `next` (positive, as typed) — or null.
 * Its money comes out of that split: `available` = what that split holds now plus what
 * this one holds now (both positive).
 */
export function childSplitProblem(
  available: number,
  next: number,
  parentLabel: string,
): string | null {
  if (!Number.isFinite(next) || next < 0)
    return 'A split amount cannot be negative';
  if (Math.abs(cents(next) - next * 100) > 1e-6)
    return 'Amounts can have at most 2 decimals';
  if (cents(next) > cents(available))
    return (
      `$${next.toFixed(2)} is more than “${parentLabel}” has left ` +
      `($${available.toFixed(2)})`
    );
  return null;
}
