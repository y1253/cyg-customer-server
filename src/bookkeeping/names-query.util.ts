import type {
  ContainsRuleView,
  NameView,
  NamesView,
  UnrecognizedView,
} from './tax.service';
import type { SubNameView } from './sub-names.service';

/**
 * step11 (2026-11-23, user's request): the Names tab paged on the server, like the ledger.
 * `TaxService.names()` still builds the whole view; these pure helpers narrow it the way the
 * tab's own filter did, and cut it into pages. Unclarified is never in the list — the tab
 * shows it above (the head).
 */
export interface NamesQuery {
  /** 'ALL' or a group key (CUSTOMER / SUPPLIER / OTHER / g<id>). */
  filter: string;
  /** Lower-cased, trimmed; '' = no search. */
  q: string;
  /**
   * The bank-description search (`TaxService.searchDescriptions`): name (lower-cased) → the
   * description keys found under it.
   */
  hits: ReadonlyMap<string, ReadonlySet<string>>;
}

const lower = (s: string) => s.toLowerCase();

/** A name's group on the Names tab (the client's `nameGroupOf`). */
export const groupOfName = (n: NameView): string =>
  n.unclarified ? 'OTHER' : (n.group ?? n.type);

/** The sub-names of each name (by the parent's lower-cased name). */
export function subsByParent(
  subs: readonly SubNameView[],
): Map<string, SubNameView[]> {
  const m = new Map<string, SubNameView[]>();
  for (const s of subs) {
    const k = lower(s.parent);
    m.set(k, [...(m.get(k) ?? []), s]);
  }
  return m;
}

/** Whether a name (or one of its sub-names) matches the search, as the tab used to judge. */
export function nameMatches(
  n: NameView,
  subs: readonly SubNameView[],
  view: Pick<NamesView, 'subDescriptions'>,
  query: Pick<NamesQuery, 'q' | 'hits'>,
): boolean {
  const q = query.q;
  if (!q) return true;
  return (
    lower(n.name).includes(q) ||
    lower(n.category).includes(q) ||
    query.hits.has(lower(n.name)) ||
    n.descriptions.some((d) => lower(d.description).includes(q)) ||
    subs.some(
      (sub) =>
        lower(sub.name).includes(q) ||
        (view.subDescriptions[sub.id] ?? []).some((d) =>
          lower(d.description).includes(q),
        ),
    )
  );
}

/** The names the list shows (Unclarified left out), in the view's order. */
export function filterNames(
  view: Pick<NamesView, 'names' | 'subDescriptions'>,
  subs: ReadonlyMap<string, SubNameView[]>,
  query: NamesQuery,
): NameView[] {
  return view.names.filter(
    (n) =>
      !n.unclarified &&
      (query.filter === 'ALL' || groupOfName(n) === query.filter) &&
      nameMatches(n, subs.get(lower(n.name)) ?? [], view, query),
  );
}

/** The chip counts: every name the search keeps (Unclarified included) and per group. */
export function groupCounts(
  view: Pick<NamesView, 'names' | 'subDescriptions'>,
  subs: ReadonlyMap<string, SubNameView[]>,
  query: Pick<NamesQuery, 'q' | 'hits'>,
): Record<string, number> {
  const counts: Record<string, number> = { ALL: 0 };
  for (const n of view.names) {
    if (!nameMatches(n, subs.get(lower(n.name)) ?? [], view, query)) continue;
    counts.ALL++;
    if (n.unclarified) continue;
    const g = groupOfName(n);
    counts[g] = (counts[g] ?? 0) + 1;
  }
  return counts;
}

/** The nameless descriptions the search keeps. */
export const filterUnrecognized = (
  list: readonly UnrecognizedView[],
  q: string,
): UnrecognizedView[] =>
  list.filter(
    (u) =>
      !q ||
      lower(u.sampleDescription).includes(q) ||
      lower(u.category).includes(q),
  );

/** The category-only contains rules the search keeps. */
export const filterContains = (
  list: readonly ContainsRuleView[],
  q: string,
): ContainsRuleView[] =>
  list.filter(
    (r) =>
      !q ||
      lower(r.text).includes(q) ||
      (r.category ?? '').toLowerCase().includes(q),
  );

/** One page of the list, and where the next one starts (null = the end). */
export function pageOfNames<T>(
  list: readonly T[],
  offset: number,
  limit: number,
): { items: T[]; nextOffset: number | null } {
  const items = list.slice(offset, offset + limit);
  const next = offset + items.length;
  return { items, nextOffset: next < list.length ? next : null };
}

/** Only the entries of the given sub-names (a page's), from a map keyed by sub-name id. */
export function pickSubs<T>(
  all: Record<number, T>,
  ids: readonly number[],
): Record<number, T> {
  const out: Record<number, T> = {};
  for (const id of ids) if (all[id] !== undefined) out[id] = all[id];
  return out;
}
