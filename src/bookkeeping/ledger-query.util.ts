import type { TransactionView } from './bookkeeping.service';
import { descriptionKey } from './name-memory.util';
import { UNCLARIFIED_NAME } from './reports.util';

/**
 * step11 (2026-11-23, user's request): the ledger is filtered, sorted, totalled and paged on
 * the SERVER — a big book made the browser slow when it got every row. This is the client's
 * old `LedgerTable` filter and `lib/table-sort.ts`, moved here (pure, spec'd): a transaction
 * and the splits under it move as ONE family, judged by the transaction itself, and a page
 * never cuts a family.
 */

export type SortDir = 'asc' | 'desc';
export type ColumnKind = 'text' | 'number' | 'date';

export interface SortState {
  key: string;
  dir: SortDir;
}

/** One column's filter: text "contains", a number range or a date range (date-only ISO). */
export interface ColumnFilter {
  text?: string;
  min?: number | null;
  max?: number | null;
  from?: string | null;
  to?: string | null;
}

export interface ColumnDef<T> {
  key: string;
  kind: ColumnKind;
  value: (row: T) => string | number | null;
}

export const isActive = (f: ColumnFilter | undefined): boolean =>
  !!f &&
  (!!f.text?.trim() ||
    (f.min !== undefined && f.min !== null) ||
    (f.max !== undefined && f.max !== null) ||
    !!f.from ||
    !!f.to);

/** Does `row` pass the column's filter? A row with no value fails any range filter. */
export function passes<T>(
  def: ColumnDef<T>,
  f: ColumnFilter | undefined,
  row: T,
): boolean {
  if (!isActive(f)) return true;
  const v = def.value(row);
  if (def.kind === 'text') {
    const q = f!.text?.trim().toLowerCase() ?? '';
    return !q || (v === null ? '' : String(v).toLowerCase()).includes(q);
  }
  if (def.kind === 'number') {
    if (typeof v !== 'number' || Number.isNaN(v)) return false;
    if (f!.min !== undefined && f!.min !== null && v < f!.min) return false;
    if (f!.max !== undefined && f!.max !== null && v > f!.max) return false;
    return true;
  }
  const d = typeof v === 'string' ? v.slice(0, 10) : '';
  if (!d) return false;
  if (f!.from && d < f!.from) return false;
  if (f!.to && d > f!.to) return false;
  return true;
}

/** Comparison on the column's value; empty values always sort last. */
export function compare<T>(
  def: ColumnDef<T>,
  a: T,
  b: T,
  dir: SortDir,
): number {
  const xa = def.value(a);
  const xb = def.value(b);
  const emptyA = xa === null || xa === undefined || xa === '';
  const emptyB = xb === null || xb === undefined || xb === '';
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  const c =
    typeof xa === 'number' && typeof xb === 'number'
      ? xa - xb
      : String(xa).localeCompare(String(xb), undefined, {
          sensitivity: 'base',
          numeric: true,
        });
  return dir === 'asc' ? c : -c;
}

/** Filter by every active column, then sort (stable — ties keep their order). */
export function applyTable<T>(
  rows: T[],
  defs: ColumnDef<T>[],
  filters: Record<string, ColumnFilter>,
  sort: SortState | null,
): T[] {
  const active = defs.filter((d) => isActive(filters[d.key]));
  const kept = active.length
    ? rows.filter((r) => active.every((d) => passes(d, filters[d.key], r)))
    : rows;
  const def = sort && defs.find((d) => d.key === sort.key);
  if (!def) return kept;
  return kept
    .map((r, i) => ({ r, i }))
    .sort((a, b) => compare(def, a.r, b.r, sort.dir) || a.i - b.i)
    .map((x) => x.r);
}

/** What the ledger is narrowed to — every field optional. */
export interface LedgerQuery {
  /** The search box: name, description, product or either account. */
  q?: string;
  /** One statement, or an account folder's statements. */
  statementIds?: number[];
  /** Rows posted to this account (either side). */
  account?: string;
  /** One transaction and its splits. */
  focusId?: number;
  /** A payee's families ("Unclarified name" = the rows with none). */
  name?: string;
  /** Rows whose description has this description's KEY (the Names tab groups by it). */
  description?: string;
  /** A sub-name's own rows. */
  subNameId?: number;
  /** Dated in this period (posted, else pending, else the statement's end). */
  from?: string;
  to?: string;
  /** Per-column filters and the sort (`ColumnHeader`). */
  filters?: Record<string, ColumnFilter>;
  sort?: SortState | null;
  /** Every family folded: the Amount column sorts / filters on the full bank amount. */
  folded?: boolean;
  /**
   * Transactions only (no starting balance / revaluation) closest to this full bank amount
   * (absolute) and day first — "Choose the transaction" for a file.
   */
  near?: { amount?: number | null; date?: string | null };
}

/** A custom column, for sorting / filtering on its answers. */
export interface QueryColumn {
  id: number;
  type: string;
}

export interface QueryContext {
  /** Each statement's last day (date-only ISO). */
  periodEnd: ReadonlyMap<number, string | null>;
  columns?: readonly QueryColumn[];
  /** A custom column's answer on a row, as text (a dropdown's label). */
  answerText?: (columnId: number, transactionId: number) => string | null;
}

/** A transaction row with its splits' money added back — what it shows folded. */
export type LedgerRow = TransactionView & { fullAmount?: number };

export interface CategoryTotal {
  category: string;
  rows: number;
  total: number;
  /** In the home currency (rows converted, plus the revaluations). */
  homeTotal: number;
}

export interface LedgerSummary {
  /** Transactions (and starting balances / revaluations) and splits the query keeps. */
  txCount: number;
  splitCount: number;
  /** Every transaction of the book, whatever the query. */
  allTx: number;
  net: number;
  /** Null when no row is in a foreign currency. */
  homeNet: number | null;
  /** A split rule's own ledger: its splits are never folded. */
  isAgency: boolean;
  /** Families the query keeps — what is paged. */
  families: number;
  /** Per category (the offset account), largest first. */
  byCategory: CategoryTotal[];
}

const cents = (n: number) => Math.round(n * 100);

/** A row's payee as the Name column shows it; a starting balance has none. */
const nameOf = (t: TransactionView): string | null =>
  t.kind === 'opening' ? null : (t.name ?? UNCLARIFIED_NAME);

/**
 * The query's families in order, each head with `fullAmount` (its own amount plus all its
 * splits, from the whole book), plus the totals over everything kept.
 */
export function queryLedger(
  all: readonly TransactionView[],
  query: LedgerQuery,
  ctx: QueryContext,
): { families: LedgerRow[][]; summary: LedgerSummary } {
  const splitCents = new Map<number, number>();
  for (const t of all)
    if (t.kind === 'split') {
      const top = t.splitOfId ?? t.id;
      splitCents.set(top, (splitCents.get(top) ?? 0) + cents(t.amount));
    }
  const fullOf = (t: TransactionView): number =>
    !t.kind && splitCents.has(t.id)
      ? (cents(t.amount) + splitCents.get(t.id)!) / 100
      : t.amount;

  const ranged = !!(query.from || query.to);
  const inRange = (t: TransactionView) => {
    if (!ranged) return true;
    const day =
      (t.postingDate ?? t.pendingDate)?.slice(0, 10) ??
      ctx.periodEnd.get(t.statementId) ??
      null;
    return (
      !!day &&
      (!query.from || day >= query.from) &&
      (!query.to || day <= query.to)
    );
  };
  const q = query.q?.trim().toLowerCase() ?? '';
  const statements = query.statementIds?.length
    ? new Set(query.statementIds)
    : null;
  const wantedDescription = query.description
    ? descriptionKey(query.description)
    : null;
  const kept = all.filter(
    (t) =>
      (query.focusId == null ||
        t.id === query.focusId ||
        t.splitOfId === query.focusId) &&
      (!statements || statements.has(t.statementId)) &&
      inRange(t) &&
      (!query.account ||
        t.debitAccount === query.account ||
        t.creditAccount === query.account) &&
      (wantedDescription === null ||
        descriptionKey(t.description) === wantedDescription) &&
      (!query.near || !t.kind || t.kind === 'split') &&
      (!q ||
        t.description.toLowerCase().includes(q) ||
        (!!query.near &&
          Math.abs(t.amount)
            .toFixed(2)
            .includes(q.replace(/[$,\s-]/g, ''))) ||
        !!t.name?.toLowerCase().includes(q) ||
        !!t.itemName?.toLowerCase().includes(q) ||
        t.debitAccount.toLowerCase().includes(q) ||
        t.creditAccount.toLowerCase().includes(q)),
  );

  // A transaction and the splits under it move as one family.
  let groups: TransactionView[][] = [];
  const at = new Map<number, TransactionView[]>();
  for (const t of kept) {
    const top = t.kind === 'split' ? (t.splitOfId ?? t.id) : null;
    const g = top !== null ? at.get(top) : undefined;
    if (g) {
      g.push(t);
      continue;
    }
    const fresh = [t];
    groups.push(fresh);
    if (!t.kind || t.kind === 'split') at.set(top ?? t.id, fresh);
  }
  const wanted = query.name?.trim().toLowerCase();
  if (wanted)
    groups = groups.filter((g) =>
      g.some((t) => nameOf(t)?.toLowerCase() === wanted),
    );
  // A sub-name's own rows — a transaction or a split.
  if (query.subNameId != null)
    groups = groups
      .map((g) => g.filter((t) => t.subName?.id === query.subNameId))
      .filter((g) => g.length > 0);

  const columns: ColumnDef<TransactionView>[] = [
    // step8: the posting date is THE date (sorted by it, like the reports).
    { key: 'date', kind: 'date', value: (t) => t.postingDate ?? t.pendingDate },
    { key: 'name', kind: 'text', value: nameOf },
    { key: 'description', kind: 'text', value: (t) => t.description },
    { key: 'product', kind: 'text', value: (t) => t.itemName ?? null },
    {
      key: 'amount',
      kind: 'number',
      value: (t) => (query.folded ? fullOf(t) : t.amount),
    },
    { key: 'debit', kind: 'text', value: (t) => t.debitAccount },
    { key: 'credit', kind: 'text', value: (t) => t.creditAccount },
    { key: 'statement', kind: 'text', value: (t) => t.statementLabel },
    ...(ctx.columns ?? []).map(
      (c): ColumnDef<TransactionView> => ({
        key: `c${c.id}`,
        kind: c.type === 'NUMBER' ? 'number' : 'text',
        value: (t) => {
          // step9 (2026-11-19): a split has its own answer, like a transaction.
          const v =
            (t.kind && t.kind !== 'split') || !ctx.answerText
              ? null
              : ctx.answerText(c.id, t.id);
          return c.type === 'NUMBER'
            ? v == null || v === ''
              ? null
              : Number(v.replace(',', '.'))
            : v;
        },
      }),
    ),
  ];
  const heads = groups.map((g) => ({
    head: g.find((t) => !t.kind) ?? g[0],
    g,
  }));
  const byHead = new Map(heads.map((h) => [h.head, h.g]));
  let sortedHeads = applyTable(
    heads.map((h) => h.head),
    columns,
    query.filters ?? {},
    query.sort ?? null,
  );
  const near = query.near;
  if (near) {
    // Splits hide part of a transaction's amount: compare on its full bank amount.
    const want = near.amount != null ? cents(Math.abs(near.amount)) : null;
    const day = near.date ? Date.parse(near.date) : null;
    const score = (t: TransactionView) => {
      const off =
        want != null ? Math.abs(Math.abs(cents(fullOf(t))) - want) : 0;
      const date = t.postingDate ?? t.pendingDate;
      const gap =
        day != null && date ? Math.abs(Date.parse(date) - day) / 86_400_000 : 0;
      return off * 10 + gap;
    };
    sortedHeads = sortedHeads
      .filter((t) => !t.kind)
      .map((t, i) => ({ t, i, s: score(t) }))
      .sort((a, b) => a.s - b.s || a.i - b.i)
      .map((x) => x.t);
  }
  const ordered = sortedHeads.map((head) => byHead.get(head) ?? [head]);

  const families: LedgerRow[][] = ordered.map((g) =>
    g.map((t) =>
      !t.kind && splitCents.has(t.id) ? { ...t, fullAmount: fullOf(t) } : t,
    ),
  );

  // Totals over every row kept — the net change is the same folded or not.
  const rows = ordered.flat();
  const foreign = rows.some((t) => t.currency);
  const homeCents = (t: TransactionView) =>
    t.kind === 'fx'
      ? cents(t.homeAmount ?? 0)
      : t.currency && t.fxRate != null
        ? Math.round(cents(t.amount) * t.fxRate)
        : cents(t.amount);
  const byCategory = new Map<string, { rows: number; c: number; h: number }>();
  let net = 0;
  let home = 0;
  let splitCount = 0;
  for (const t of rows) {
    if (t.kind === 'split') splitCount++;
    net += cents(t.amount);
    home += homeCents(t);
    const cat = byCategory.get(t.offsetAccount) ?? { rows: 0, c: 0, h: 0 };
    cat.rows++;
    cat.c += cents(t.amount);
    cat.h += homeCents(t);
    byCategory.set(t.offsetAccount, cat);
  }
  return {
    families,
    summary: {
      txCount: rows.length - splitCount,
      splitCount,
      allTx: all.filter((t) => t.kind !== 'split').length,
      net: net / 100,
      homeNet: foreign ? home / 100 : null,
      isAgency:
        !!query.account &&
        all.some((t) => !!t.splitRule && t.offsetAccount === query.account),
      families: families.length,
      byCategory: [...byCategory.entries()]
        .map(([category, v]) => ({
          category,
          rows: v.rows,
          total: v.c / 100,
          homeTotal: v.h / 100,
        }))
        .sort(
          (a, b) =>
            Math.abs(b.total) - Math.abs(a.total) ||
            a.category.localeCompare(b.category),
        ),
    },
  };
}

/** One page of families: `offset` / `limit` count FAMILIES, so a family is never cut. */
export function pageOfFamilies(
  families: LedgerRow[][],
  offset: number,
  limit: number,
): { rows: LedgerRow[]; nextOffset: number | null } {
  const slice = families.slice(offset, offset + limit);
  const next = offset + slice.length;
  return {
    rows: slice.flat(),
    nextOffset: next < families.length ? next : null,
  };
}
