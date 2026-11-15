/** step2 (2026-11-15): "Walmart - Maintenance" — what a sub-name of a name is called. */
export const subNameOf = (parent: string, category: string): string =>
  `${parent} - ${category}`.slice(0, 191);

/** step9: a split transaction (a parent) as `parentSubName` sees it. */
export interface ParentRow {
  /** The transaction's own name (null = none). */
  name: string | null;
  /** Its own category (`offsetAccount`). */
  category: string;
  /** At least one of its splits has a sub-name. */
  hasSubSplits: boolean;
  /** The sub-name it has now (parent name + category), if any. */
  current: { parent: string; category: string } | null;
}

/**
 * step9 (2026-11-15, user's request): when a split of a transaction gets a sub-name, the
 * transaction itself gets one too — "<name> - <its own category>" — so on the Names tab every
 * part of it is listed under its name. What it should have (null = none: no split has a
 * sub-name any more, or it has no name), and whether that differs from what it has. Pure.
 */
export function parentSubName(p: ParentRow): {
  want: { parent: string; category: string } | null;
  change: boolean;
} {
  const want =
    p.hasSubSplits && p.name ? { parent: p.name, category: p.category } : null;
  const same =
    want === null
      ? p.current === null
      : p.current !== null &&
        p.current.parent.toLowerCase() === want.parent.toLowerCase() &&
        p.current.category === want.category;
  return { want, change: !same };
}
