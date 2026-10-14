import {
  ACCOUNT_NAMES,
  OWNERS_LOAN,
  UNCATEGORIZED,
  normalizeAccount,
} from './chart-of-accounts';

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
  /** The customer's own categories (`CustomerAccount`) — valid in their rules. */
  customAccounts?: ReadonlySet<string>;
  /** The statement's bank ("TD Canada Trust") — the payee of its own fees and interest. */
  bankName?: string | null;
  /** The customer's category for each final name (`indexRules`), by `nameKey`. */
  nameCategories?: ReadonlyMap<string, string>;
  /** FIRM memory of each name's ONE category (`NameMemory`), by `nameKey`. */
  nameMemory?: ReadonlyMap<string, string>;
}

/** Common banks by the name their customers use for them; anything else stays as printed. */
const BANK_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/^td\b|toronto[- ]dominion/i, 'TD Bank'],
  [/^bmo\b|bank of montreal|banque de montr[ée]al/i, 'BMO'],
  [/^rbc\b|royal bank/i, 'RBC'],
  [/^cibc\b|canadian imperial/i, 'CIBC'],
  [/scotia/i, 'Scotiabank'],
  [/national bank|banque nationale/i, 'National Bank'],
  [/desjardins/i, 'Desjardins'],
];

/** The payee name for a bank's own charges: "TD Canada Trust" → "TD Bank". */
export function bankPayeeName(
  bankName: string | null | undefined,
): string | null {
  const raw = cleanName(bankName);
  if (!raw) return null;
  return BANK_NAMES.find(([re]) => re.test(raw))?.[1] ?? raw;
}

/** A category the bank itself charges or pays: its fees and interest. */
export const isBankCharge = (category: string): boolean =>
  /interest|bank fee|bank charge|service charge/i.test(category);

/** The categories an own-account move is read as before it is moved to Owner's Loan. */
const OWN_MOVE_CATEGORIES: ReadonlySet<string> = new Set([
  'Transfer Between Accounts',
  'Credit Card Payment',
]);

/** Money sent to other people, which only LOOKS like a transfer. */
const NOT_OWN_MOVE =
  /\binterac\b|\be[- ]?(?:transfer|tfr)\b|\bemail money\b|\bwire\b/i;
const CARD = '(?:visa|master ?card|amex|american express|credit card|cc)';
const PAID = '(?:payment|pymt|pmt|paiement)';
const CARD_PAYMENT = new RegExp(
  [
    `\\b${CARD}\\b.*\\b${PAID}\\b`,
    `\\b${PAID}\\b.*\\b${CARD}\\b`,
    `\\b${PAID}\\b.*\\b(?:thank you|merci)\\b`,
    '\\bpayment received\\b',
  ].join('|'),
  'i',
);
const OWN_TRANSFER = /\b(?:transfer|xfer|tfr|virement)\b/i;

/**
 * A transfer between the owner's own accounts or a payment to a credit card (Visa, …).
 * Always booked to Owner's Loan (user's decision 2026-10-13): by the category the AI or
 * the firm memory chose for it, or by the description itself. Interac e-transfers and
 * wires go to other people and are left alone.
 */
export function isOwnersLoanMove(
  description: string,
  category: string,
): boolean {
  if (OWN_MOVE_CATEGORIES.has(category)) return true;
  if (NOT_OWN_MOVE.test(description)) return false;
  return CARD_PAYMENT.test(description) || OWN_TRANSFER.test(description);
}

export type NameSource = 'ai' | 'memory' | 'customer';

export interface Resolved {
  name: string | null;
  category: string;
  source: NameSource;
  /**
   * The row's category is its NAME's category (not a customer's category, not a forced
   * default), so every row of that name in a batch must share it.
   */
  followsName: boolean;
  /** …and the name too came from the AI / firm memory, so `NameMemory` may learn it. */
  learnable: boolean;
}

/**
 * The name and category a row ends up with. Each step overrides the one before:
 *
 * 1. the AI's own answer;
 * 2. the FIRM memory for this description — what was concluded the first time it was seen,
 *    so the same description reads the same everywhere (an empty memory field keeps the
 *    AI's value);
 * 3. still no name, and a bank fee or interest: the statement's bank ("TD Bank") — never
 *    written to the firm memory, which serves every bank;
 * 4. a transfer between the owner's accounts or a credit-card payment: Owner's Loan
 *    (`isOwnersLoanMove`) — never written to the firm memory either;
 * 5. the customer's DESCRIPTION rule — how an unrecognised row is assigned;
 * 6. the customer's NAME rule, matched on the name as it stands after 1–5;
 * 7. the name's ONE category (user's rule 2026-10-14: a name never has two categories):
 *    the customer's category for the FINAL name (`nameCategories`), else — unless a rule
 *    set the category — the firm `NameMemory` category of that name. Bank fees/interest and Owner's Loan moves are forced
 *    defaults and keep theirs ("TD Bank" both charges fees and pays interest).
 *
 * So a customer's own edit always wins, and the AI is the last resort, never the first.
 * The category always goes through `normalizeAccount`: nothing outside the chart gets in.
 */
export function resolveRow(
  row: { description: string; name?: string | null; offsetAccount: string },
  ctx: ResolveContext,
): Resolved {
  let name = cleanName(row.name);
  let category = normalizeAccount(row.offsetAccount, ctx.customAccounts);
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

  if (!name && isBankCharge(category)) name = bankPayeeName(ctx.bankName);
  const ownMove = isOwnersLoanMove(row.description, category);
  if (ownMove) category = OWNERS_LOAN;
  const forced = ownMove || isBankCharge(category);

  let customerName = false;
  let customerCategory = false;
  const apply = (rule: NameRule | undefined) => {
    if (!rule) return;
    const ruleName = cleanName(rule.name);
    if (ruleName) {
      name = ruleName;
      customerName = true;
    }
    if (rule.category) {
      category = normalizeAccount(rule.category, ctx.customAccounts);
      customerCategory = true;
    }
    source = 'customer';
  };
  if (key) apply(ctx.descRules.get(key));
  if (name) apply(ctx.nameRules.get(nameKey(name)));

  // The customer's category for the name the row ends up with wins over everything.
  const own = name ? ctx.nameCategories?.get(nameKey(name)) : undefined;
  if (own) {
    category = normalizeAccount(own, ctx.customAccounts);
    customerCategory = true;
    source = 'customer';
  }

  const followsName = !!name && !forced && !customerCategory;
  if (followsName) {
    const known = ctx.nameMemory?.get(nameKey(name!));
    if (known && normalizeAccount(known) !== UNCATEGORIZED) {
      category = normalizeAccount(known);
      if (source === 'ai') source = 'memory';
    }
  }

  return {
    name,
    category,
    source,
    followsName,
    learnable: followsName && !customerName,
  };
}

/**
 * Resolve a whole statement so that every row of one name gets ONE category: a name the
 * firm memory does not know yet takes the FIRST category it was given in this batch.
 * Returns the rows and the name memory as extended by the batch.
 */
export function resolveRows<
  T extends {
    description: string;
    name?: string | null;
    offsetAccount: string;
  },
>(
  rows: readonly T[],
  ctx: ResolveContext,
): { resolved: Resolved[]; nameMemory: Map<string, string> } {
  const nameMemory = new Map(ctx.nameMemory ?? []);
  const first = rows.map((r) => resolveRow(r, ctx));
  let added = false;
  for (const out of first) {
    if (!out.followsName || !out.name || out.category === UNCATEGORIZED) {
      continue;
    }
    const k = nameKey(out.name);
    const known = nameMemory.get(k);
    if (known && normalizeAccount(known) !== UNCATEGORIZED) continue;
    nameMemory.set(k, out.category);
    added = true;
  }
  if (!added) return { resolved: first, nameMemory };
  const next = { ...ctx, nameMemory };
  return { resolved: rows.map((r) => resolveRow(r, next)), nameMemory };
}

/** One write to the firm name memory. */
export interface NameMemoryWrite {
  nameKey: string;
  sampleName: string;
  category: string;
}

/**
 * Which names the firm `NameMemory` should learn from a resolved batch: a name it has
 * never seen is stored with its category; one it holds as Uncategorized is filled; one
 * it knows is never replaced. Only names AND categories the AI / firm memory produced —
 * a customer's rename or category never goes in (`learnable`).
 */
export function nameMemoryWrites(
  resolved: readonly Resolved[],
  known: ReadonlyMap<string, string>,
): { creates: NameMemoryWrite[]; fills: NameMemoryWrite[] } {
  const creates = new Map<string, NameMemoryWrite>();
  const fills = new Map<string, NameMemoryWrite>();
  for (const r of resolved) {
    if (!r.learnable || !r.name || r.category === UNCATEGORIZED) continue;
    if (!ACCOUNT_NAMES.includes(r.category)) continue;
    const k = nameKey(r.name).slice(0, KEY_MAX);
    if (!k) continue;
    const write = { nameKey: k, sampleName: r.name, category: r.category };
    const had = known.get(k);
    if (had === undefined) {
      if (!creates.has(k)) creates.set(k, write);
    } else if (normalizeAccount(had) === UNCATEGORIZED && !fills.has(k)) {
      fills.set(k, write);
    }
  }
  return { creates: [...creates.values()], fills: [...fills.values()] };
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
  nameCategories: Map<string, string>;
} {
  const descRules = new Map<string, NameRule>();
  const nameRules = new Map<string, NameRule>();
  const nameCategories = new Map<string, string>();
  for (const r of rules) {
    if (r.matchType === 'DESCRIPTION') descRules.set(r.matchKey, r);
    else nameRules.set(r.matchKey, r);
  }
  // The customer's category for each FINAL name: a rule keyed on the name itself first,
  // then any rename rule that leads to it.
  for (const r of nameRules.values()) {
    if (!r.category || !cleanName(r.name)) continue;
    const k = nameKey(r.name!);
    if (!nameCategories.has(k)) nameCategories.set(k, r.category);
  }
  for (const r of nameRules.values()) {
    if (r.category && !cleanName(r.name))
      nameCategories.set(r.matchKey, r.category);
  }
  return { descRules, nameRules, nameCategories };
}
