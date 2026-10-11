import { UNCATEGORIZED, normalizeAccount } from './chart-of-accounts';

/** How a customer rule is matched. */
export type RuleMatchType = 'NAME' | 'DESCRIPTION';
export const RULE_MATCH_TYPES: readonly RuleMatchType[] = [
  'NAME',
  'DESCRIPTION',
];

/** The column widths of `DescriptionMemory` / `CustomerNameRule`. */
const KEY_MAX = 191;
const NAME_MAX = 191;

/**
 * The lookup key for a transaction description — what makes "the same description" repeat.
 *
 * Raw descriptions carry reference numbers, card digits and dates ("POS 0923 WALMART #1234
 * TORONTO ON"), so matching them verbatim would never hit twice. Lower-cased, accents
 * stripped, every digit and punctuation mark turned into a space, one-letter tokens dropped,
 * spaces collapsed: "pos walmart toronto on". Empty when nothing is left (a description of
 * only numbers) — such a key is never stored or matched.
 */
export function descriptionKey(description: string | null | undefined): string {
  return (description ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1)
    .join(' ')
    .slice(0, KEY_MAX)
    .trim();
}

/** A payee name as stored: trimmed, capped, empty → null. */
export function cleanName(name: string | null | undefined): string | null {
  return (name ?? '').trim().slice(0, NAME_MAX) || null;
}

/** The lower-cased form a NAME rule is keyed on. MySQL compares names the same way. */
export const nameKey = (name: string): string => name.trim().toLowerCase();

/** What the firm memory holds for one description key. */
export interface MemoryEntry {
  name: string | null;
  category: string;
}

/** A customer's own rule. A null field leaves that value as it is. */
export interface NameRule {
  matchType: RuleMatchType;
  matchKey: string;
  name: string | null;
  category: string | null;
}

export interface ResolveContext {
  /** Firm memory by description key. */
  memory: ReadonlyMap<string, MemoryEntry>;
  /** The customer's DESCRIPTION rules by description key. */
  descRules: ReadonlyMap<string, NameRule>;
  /** The customer's NAME rules by lower-cased name. */
  nameRules: ReadonlyMap<string, NameRule>;
}

export type NameSource = 'ai' | 'memory' | 'customer';

export interface Resolved {
  name: string | null;
  category: string;
  source: NameSource;
}

/**
 * The name and category a row ends up with. Each step overrides the one before:
 *
 * 1. the AI's own answer;
 * 2. the FIRM memory for this description — what was concluded the first time it was seen,
 *    so the same description reads the same everywhere (an empty memory field keeps the
 *    AI's value);
 * 3. the customer's DESCRIPTION rule — how an unrecognised row is assigned;
 * 4. the customer's NAME rule, matched on the name as it stands after 1–3.
 *
 * So a customer's own edit always wins, and the AI is the last resort, never the first.
 * The category always goes through `normalizeAccount`: nothing outside the chart gets in.
 */
export function resolveRow(
  row: { description: string; name?: string | null; offsetAccount: string },
  ctx: ResolveContext,
): Resolved {
  let name = cleanName(row.name);
  let category = normalizeAccount(row.offsetAccount);
  let source: NameSource = 'ai';
  const key = descriptionKey(row.description);

  const remembered = key ? ctx.memory.get(key) : undefined;
  if (remembered) {
    const memName = cleanName(remembered.name);
    const memCategory = normalizeAccount(remembered.category);
    if (memName) name = memName;
    if (memCategory !== UNCATEGORIZED) category = memCategory;
    if (memName || memCategory !== UNCATEGORIZED) source = 'memory';
  }

  const apply = (rule: NameRule | undefined) => {
    if (!rule) return;
    const ruleName = cleanName(rule.name);
    if (ruleName) name = ruleName;
    if (rule.category) category = normalizeAccount(rule.category);
    source = 'customer';
  };
  if (key) apply(ctx.descRules.get(key));
  if (name) apply(ctx.nameRules.get(nameKey(name)));

  return { name, category, source };
}

/** One write to the firm memory. */
export interface MemoryWrite {
  descriptionKey: string;
  sampleDescription: string;
  name: string | null;
  category: string;
}

/**
 * Which of the AI's answers the firm memory should learn.
 *
 * - A description the memory has never seen → stored, once per key even if it repeats.
 * - One it has seen, but with a blank (no name, or Uncategorized) the AI has now filled →
 *   that gap is filled. A value the memory already has is never replaced: "if it was
 *   assumed once, reuse it".
 * - An answer with nothing in it (no name AND Uncategorized) is not stored, so a later
 *   read can still teach the memory something.
 *
 * Only AI answers come in here — never a customer's rule, which is private to them.
 */
export function memoryWrites(
  rows: ReadonlyArray<{
    description: string;
    name?: string | null;
    offsetAccount: string;
  }>,
  memory: ReadonlyMap<string, MemoryEntry>,
): { creates: MemoryWrite[]; fills: MemoryWrite[] } {
  const creates = new Map<string, MemoryWrite>();
  const fills = new Map<string, MemoryWrite>();
  for (const row of rows) {
    const key = descriptionKey(row.description);
    if (!key) continue;
    const name = cleanName(row.name);
    const category = normalizeAccount(row.offsetAccount);
    if (!name && category === UNCATEGORIZED) continue;
    const write: MemoryWrite = {
      descriptionKey: key,
      sampleDescription: row.description.trim().slice(0, 512),
      name,
      category,
    };
    const known = memory.get(key);
    if (!known) {
      if (!creates.has(key)) creates.set(key, write);
      continue;
    }
    const fillName = !cleanName(known.name) && name;
    const fillCategory =
      normalizeAccount(known.category) === UNCATEGORIZED &&
      category !== UNCATEGORIZED;
    if ((fillName || fillCategory) && !fills.has(key)) {
      fills.set(key, {
        ...write,
        name: fillName ? name : cleanName(known.name),
        category: fillCategory ? category : normalizeAccount(known.category),
      });
    }
  }
  return { creates: [...creates.values()], fills: [...fills.values()] };
}

/** Index customer rules for `resolveRow`. */
export function indexRules(rules: readonly NameRule[]): {
  descRules: Map<string, NameRule>;
  nameRules: Map<string, NameRule>;
} {
  const descRules = new Map<string, NameRule>();
  const nameRules = new Map<string, NameRule>();
  for (const r of rules) {
    if (r.matchType === 'DESCRIPTION') descRules.set(r.matchKey, r);
    else nameRules.set(r.matchKey, r);
  }
  return { descRules, nameRules };
}
