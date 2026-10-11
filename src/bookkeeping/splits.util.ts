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
 */
export function splitProblem(
  parentAmount: number,
  amounts: readonly number[],
): string | null {
  if (parentAmount === 0) return 'A $0.00 transaction cannot be split';
  for (const a of amounts) {
    if (!Number.isFinite(a) || a <= 0)
      return 'Every split needs an amount above $0.00';
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
