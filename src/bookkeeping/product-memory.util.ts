import { UNCATEGORIZED, normalizeAccount } from './chart-of-accounts';
import { itemKey } from './receipt-items.util';

/** Where an item's category came from — shown as a badge on the Products tab. */
export type ProductSource = 'rule' | 'memory' | 'parent';

/** One item the firm memory should learn (`ProductMemory`). */
export interface ProductMemoryWrite {
  itemKey: string;
  sampleName: string;
  category: string;
}

/**
 * The category one receipt item goes in (PURE).
 *
 * The customer's own rule wins; then the firm memory (which the caller has already filled
 * with the AI's answers for items it lacked); then the transaction's own category. An
 * Uncategorized memory entry counts as none.
 */
export function resolveItem(
  key: string,
  rules: ReadonlyMap<string, string>,
  memory: ReadonlyMap<string, string>,
  parentCategory: string,
): { category: string; source: ProductSource } {
  const rule = key ? rules.get(key) : undefined;
  if (rule) return { category: rule, source: 'rule' };
  const remembered = key ? memory.get(key) : undefined;
  if (remembered && normalizeAccount(remembered) !== UNCATEGORIZED) {
    return { category: normalizeAccount(remembered), source: 'memory' };
  }
  return { category: parentCategory, source: 'parent' };
}

/**
 * The items the AI should be asked about: neither the customer's rule nor the firm memory
 * knows them. Once per key, empty keys (a name of only digits) never.
 */
export function itemsToAsk(
  names: readonly string[],
  rules: ReadonlyMap<string, string>,
  memory: ReadonlyMap<string, string>,
): Array<{ key: string; name: string }> {
  const out = new Map<string, string>();
  for (const name of names) {
    const key = itemKey(name);
    if (!key || out.has(key) || rules.has(key)) continue;
    const known = memory.get(key);
    if (known && normalizeAccount(known) !== UNCATEGORIZED) continue;
    out.set(key, name.trim());
  }
  return [...out].map(([key, name]) => ({ key, name }));
}

/**
 * Which of the AI's answers the firm memory should learn — `memoryWrites` for items.
 * A new key is created; a key the memory holds as Uncategorized is filled; a key it already
 * knows is never replaced ("assumed once → reused"); an Uncategorized answer is never stored.
 * Only AI answers come in here, never a customer's rule.
 */
export function productMemoryWrites(
  answers: ReadonlyArray<{ key: string; name: string; category: string }>,
  memory: ReadonlyMap<string, string>,
): { creates: ProductMemoryWrite[]; fills: ProductMemoryWrite[] } {
  const creates = new Map<string, ProductMemoryWrite>();
  const fills = new Map<string, ProductMemoryWrite>();
  for (const a of answers) {
    const category = normalizeAccount(a.category);
    if (!a.key || category === UNCATEGORIZED) continue;
    const write = {
      itemKey: a.key,
      sampleName: a.name.trim().slice(0, 512),
      category,
    };
    const known = memory.get(a.key);
    if (known === undefined) {
      if (!creates.has(a.key)) creates.set(a.key, write);
    } else if (normalizeAccount(known) === UNCATEGORIZED && !fills.has(a.key)) {
      fills.set(a.key, write);
    }
  }
  return { creates: [...creates.values()], fills: [...fills.values()] };
}

/** One product on the Products tab. */
export interface ProductView {
  itemKey: string;
  /** The item as most recently printed on a receipt. */
  name: string;
  /** The category its rows are in now (the rule's when there is one). */
  category: string;
  source: ProductSource;
  /** What the firm memory (the AI) says, null when it knows nothing. */
  suggested: string | null;
  rows: number;
  /** Σ |amount| of its rows, in dollars. */
  total: number;
}

/**
 * The Products tab (PURE): the customer's item rows grouped by `itemKey`, most rows first.
 * Without a rule, an item shows the category most of its rows are in.
 */
export function groupProducts(
  rows: ReadonlyArray<{
    id: number;
    itemName: string;
    amount: number;
    offsetAccount: string;
  }>,
  rules: ReadonlyMap<string, string>,
  memory: ReadonlyMap<string, string>,
): ProductView[] {
  const groups = new Map<
    string,
    {
      name: string;
      lastId: number;
      rows: number;
      cents: number;
      cats: Map<string, number>;
    }
  >();
  for (const r of rows) {
    const key = itemKey(r.itemName);
    if (!key) continue;
    const g = groups.get(key) ?? {
      name: r.itemName,
      lastId: r.id,
      rows: 0,
      cents: 0,
      cats: new Map<string, number>(),
    };
    if (r.id >= g.lastId) {
      g.lastId = r.id;
      g.name = r.itemName;
    }
    g.rows += 1;
    g.cents += Math.abs(Math.round(r.amount * 100));
    g.cats.set(r.offsetAccount, (g.cats.get(r.offsetAccount) ?? 0) + 1);
    groups.set(key, g);
  }
  return [...groups]
    .map(([key, g]) => {
      const usual = [...g.cats].sort((a, b) => b[1] - a[1])[0][0];
      const remembered = memory.get(key);
      const suggested =
        remembered && normalizeAccount(remembered) !== UNCATEGORIZED
          ? normalizeAccount(remembered)
          : null;
      const rule = rules.get(key);
      return {
        itemKey: key,
        name: g.name,
        category: rule ?? usual,
        source: (rule
          ? 'rule'
          : suggested
            ? 'memory'
            : 'parent') as ProductSource,
        suggested,
        rows: g.rows,
        total: g.cents / 100,
      };
    })
    .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
}
