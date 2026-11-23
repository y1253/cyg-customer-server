/** step2 (2026-11-15): "Walmart - Maintenance" — what a sub-name of a name is called. */
export const subNameOf = (parent: string, category: string): string =>
  `${parent} - ${category}`.slice(0, 191);

/**
 * step12 (2026-11-22): "Amazon - Supplies - Quebec taxes" — the sub-name of a transaction cut
 * by a ONE-TIME split by a split group / rule (`label`). step12 (2026-11-23): the label is
 * always kept — without it the name is the ordinary sub-name's, and picks are keyed by name.
 */
export const splitSubNameOf = (
  parent: string,
  category: string,
  label: string,
): string =>
  label.trim()
    ? `${parent} - ${category} - ${label.trim()}`.slice(0, 191)
    : subNameOf(parent, category);

/** step12: the group / rule part of a one-time split's sub-name (`splitSubNameOf`). */
export const splitLabelOf = (
  name: string,
  parent: string,
  category: string,
): string => {
  const head = `${parent} - ${category} - `;
  return name.toLowerCase().startsWith(head.toLowerCase())
    ? name.slice(head.length)
    : category;
};

/** step9: a split transaction (a parent) as `parentSubName` sees it. */
export interface ParentRow {
  /** The transaction's own name (null = none). */
  name: string | null;
  /** Its own category (`offsetAccount`). */
  category: string;
  /**
   * It is split: a split the customer made, or one with a sub-name. step9 (2026-11-17,
   * second request): ANY split names the transaction at once, even one left in its category.
   */
  hasSplits: boolean;
  /**
   * step9 (2026-11-17, second request): its name has sub-names — a wrapper ("rubber band")
   * whose every row sits under the sub-name of its category, split or not.
   */
  nameHasSubs?: boolean;
  /** The sub-name it has now (parent name + category), if any. */
  current: { parent: string; category: string } | null;
  /**
   * step9 (2026-11-17): its current sub-name was given by its description rule (a rule saved
   * from a split) — kept while no split of its own decides.
   */
  fromRule?: boolean;
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
    (p.hasSplits || p.nameHasSubs) && p.name
      ? { parent: p.name, category: p.category }
      : p.fromRule
        ? p.current
        : null;
  const same =
    want === null
      ? p.current === null
      : p.current !== null &&
        p.current.parent.toLowerCase() === want.parent.toLowerCase() &&
        p.current.category === want.category;
  return { want, change: !same };
}

/** step9 (2026-11-17, second request): a row as `subNameFiling` sees it. */
export interface FilingRow {
  id: number;
  name: string | null;
  /** Its category (`offsetAccount`). */
  category: string;
  subNameId: number | null;
}

/**
 * step9 (2026-11-17, second request — "Walmart should get like a rubber band to wrap up all
 * under him"): a name with sub-names is only a wrapper; every row of it sits under the
 * sub-name of its own category. The rows not there yet (no sub-name, or one of another
 * category or name) with the (name, category) they belong under. `wrappers` = lower-cased
 * name to its `LedgerName` id; `subs` = sub-name id to its parent and category. Pure.
 */
export function subNameFiling(
  rows: readonly FilingRow[],
  wrappers: ReadonlyMap<string, number>,
  subs: ReadonlyMap<number, { nameId: number; category: string }>,
): { id: number; name: string; category: string }[] {
  const out: { id: number; name: string; category: string }[] = [];
  for (const r of rows) {
    const name = r.name?.trim();
    const nameId = name
      ? wrappers.get(name.replace(/\s+/g, ' ').toLowerCase())
      : undefined;
    if (!name || nameId === undefined) continue;
    const sub = r.subNameId !== null ? subs.get(r.subNameId) : undefined;
    if (sub && sub.nameId === nameId && sub.category === r.category) continue;
    out.push({ id: r.id, name, category: r.category });
  }
  return out;
}
