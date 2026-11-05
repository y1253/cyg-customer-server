/**
 * step8 (2026-11-05): may account `from` be merged into account `into` (the Chart of
 * accounts / Balance sheet: drag one account onto another)? Pure, so it is unit-tested; the
 * client asks the same question before it offers the drop.
 */

/** What decides whether two accounts can become one. */
export interface MergeSide {
  name: string;
  /** A tax agency — its rows are computed tax lines, never merged. */
  agency: boolean;
  /**
   * Its Bank feeds folder (statements filed under it, or a connected bank account), or null
   * for a plain category. `currency` null = not known (nothing printed or set: the home
   * currency, which a connected bank may still report by its code).
   */
  folder: { kind: 'BANK' | 'CREDIT_CARD'; currency: string | null } | null;
}

/** Names that are a figure or a holding place, never an account of their own to merge. */
const NOT_MERGEABLE = new Set(['retained earnings', 'uncategorized']);

/** Why the merge is refused, in words for the customer; null = it may go ahead. */
export function mergeRefusal(from: MergeSide, into: MergeSide): string | null {
  const same = (a: string, b: string) =>
    a.trim().toLowerCase() === b.trim().toLowerCase();
  if (same(from.name, into.name)) return 'That is the same account.';
  for (const side of [from, into]) {
    if (NOT_MERGEABLE.has(side.name.trim().toLowerCase()))
      return `"${side.name}" cannot be merged.`;
    if (side.agency)
      return `"${side.name}" is a tax agency — tax agencies cannot be merged.`;
  }
  if (!!from.folder !== !!into.folder) {
    const [bank, other] = from.folder ? [from, into] : [into, from];
    return `"${bank.name}" has its own folder on Bank feeds and "${other.name}" does not — a bank or card account can only be merged with another one that has a folder.`;
  }
  if (from.folder && into.folder) {
    if (from.folder.kind !== into.folder.kind)
      return 'A bank account cannot be merged with a credit card.';
    const a = from.folder.currency?.toUpperCase();
    const b = into.folder.currency?.toUpperCase();
    if (a && b && a !== b)
      return `"${from.name}" and "${into.name}" are in different currencies.`;
  }
  return null;
}
