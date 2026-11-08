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

/**
 * step2 (2026-11-08): accounts the books make up on READ (Starting balance rows, FX
 * revaluation, net income) or keep as a holding place — renaming one would split it in two.
 */
const NOT_RENAMABLE = new Set([
  ...NOT_MERGEABLE,
  "owner's loan",
  'exchange gain or loss',
]);

/**
 * step2 (2026-11-08): may account `from` be renamed to `to` (click its name on the reports or
 * its Bank feeds folder)? `taken` = another account of this book already has that name (then
 * it is a merge, not a rename). Null = it may go ahead.
 */
export function renameRefusal(
  from: MergeSide,
  to: string,
  taken: boolean,
): string | null {
  const name = to.trim();
  if (!name) return 'Enter the new name.';
  if (name === from.name.trim()) return 'That is already its name.';
  if (NOT_RENAMABLE.has(from.name.trim().toLowerCase()))
    return `"${from.name}" cannot be renamed.`;
  if (from.agency)
    return `"${from.name}" is a tax agency — rename it in your tax settings.`;
  if (NOT_RENAMABLE.has(name.toLowerCase()))
    return `"${name}" is kept for the books' own use — pick another name.`;
  if (taken)
    return `You already have an account called "${name}". Drag one onto the other to merge them instead.`;
  return null;
}
