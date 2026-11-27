import { descriptionKey } from './name-memory.util';

/**
 * step11.md (2026-11-25) — the QuickBooks import: when an admin turns on "send bank
 * transactions to QuickBooks", the company's QuickBooks history (since a date the admin
 * picks) is turned into the customer's own rules here. This file is the pure part: match
 * QuickBooks transactions to our bank rows, propose NAME / DESCRIPTION rules, and say where
 * the history is messy (questions for the admin). No AI — the internal API's AI only reviews
 * the result. The shapes are mirrored in the internal server's `quickbooks-import/`.
 */

/** One line of a QuickBooks Purchase / Deposit: its account (our category) and amount. */
export interface QboHistoryLine {
  category: string;
  /** QuickBooks' AccountType ("Expense", "Income", …), when known. */
  categoryType: string | null;
  cents: number;
}

/** One QuickBooks Purchase / Deposit, flattened by the internal API. */
export interface QboHistoryTxn {
  qboId: string;
  type: 'Purchase' | 'Deposit';
  /** YYYY-MM-DD */
  date: string;
  /** The bank amount in cents: + = money in, − = money out. */
  cents: number;
  bankAccountId: string | null;
  bankAccountName: string | null;
  /** The vendor / customer / employee's DisplayName; null = none. */
  payee: string | null;
  lines: QboHistoryLine[];
}

/** A top-level bank row of the book, as the matcher needs it. */
export interface BookRow {
  id: number;
  /** YYYY-MM-DD — posted, else pending. */
  date: string | null;
  cents: number;
  description: string;
  name: string | null;
  category: string;
  /** The QuickBooks bank account its Plaid account posts to (`PlaidAccount.qboAccountId`). */
  qboAccountId: string | null;
  accountName: string | null;
}

/** One of the customer's own NAME / DESCRIPTION rules today. */
export interface ExistingRule {
  matchType: 'NAME' | 'DESCRIPTION';
  matchKey: string;
  name: string | null;
  category: string | null;
}

export interface CategoryCount {
  category: string;
  count: number;
}

/** A payee seen in QuickBooks and what the import would make of it. */
export interface NameProposal {
  id: string;
  payee: string;
  /** Every category QuickBooks filed it under, most used first. */
  categories: CategoryCount[];
  /** The ONE category its NAME rule gives; null = none (asked, or skipped). */
  category: string | null;
  /** The admin chose sub-names: one per category, and "<payee>-mix" in QuickBooks. */
  split: boolean;
  /** Our names that QuickBooks calls by this payee — renamed to it (NAME rules). */
  aliases: string[];
  /** The bank descriptions of its matched rows that always meant ONE category. */
  descriptions: Array<{
    key: string;
    example: string;
    category: string;
    count: number;
  }>;
  /** QuickBooks transactions of this payee. */
  count: number;
  skip: boolean;
}

/** A bank description that should name its rows (our name differs from QuickBooks'). */
export interface DescriptionProposal {
  id: string;
  key: string;
  example: string;
  payee: string;
  category: string | null;
  count: number;
  skip: boolean;
}

export type ImportQuestionKind =
  | 'NAME_CATEGORIES'
  | 'DESCRIPTION_CONFLICT'
  | 'RULE_CONFLICT';

export interface ImportQuestion {
  id: string;
  kind: ImportQuestionKind;
  title: string;
  detail: string | null;
  options: Array<{ value: string; label: string; detail?: string }>;
  /** What the answer changes. */
  target:
    | { type: 'name'; id: string }
    | { type: 'alias'; id: string; alias: string }
    | { type: 'name-category'; id: string }
    | { type: 'description'; id: string }
    | { type: 'description-choice'; key: string; example: string };
  /** Options of a DESCRIPTION_CONFLICT, by value. */
  choices?: Record<string, { payee: string; category: string | null }>;
}

export interface ImportAnalysis {
  since: string | null;
  stats: {
    qboTransactions: number;
    bookRows: number;
    matched: number;
    payees: number;
  };
  names: NameProposal[];
  descriptions: DescriptionProposal[];
  questions: ImportQuestion[];
  /** Every QuickBooks category used, with its type — made the customer's own if new. */
  categories: Array<{ name: string; type: string | null }>;
  /**
   * step11 part 4 (2026-11-27): which bank row each QuickBooks transaction is (and that row's
   * splits, filled by the service) — the internal API gives each its own QuickBooks values.
   */
  matches: QboMatch[];
}

export interface QboMatch {
  qboId: string;
  transactionId: number;
  category: string;
  splits: Array<{ id: number; category: string }>;
}

/** The answer values every question understands besides its own options. */
export const SPLIT = '__SPLIT__';
export const SKIP = '__SKIP__';
export const OURS = '__OURS__';
export const QBO = '__QBO__';

const DAY_MS = 86_400_000;
/** How far a bank date and a QuickBooks date may be apart and still be one transaction. */
export const MATCH_DAYS = 3;

/** QuickBooks' own "no category" accounts — never a category worth a rule. */
const UNCATEGORIZED_QBO = /^uncategori[sz]ed( (expense|income|asset))?$/i;

export const nameKey = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toLowerCase();

const dayOf = (iso: string): number =>
  Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Cleans what the internal API sent: drops anything not shaped like a transaction. */
export function cleanTxns(input: unknown): QboHistoryTxn[] {
  if (!Array.isArray(input)) return [];
  const out: QboHistoryTxn[] = [];
  for (const raw of input as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue;
    const date = typeof raw.date === 'string' ? raw.date.slice(0, 10) : '';
    const cents = Number(raw.cents);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(cents) || !cents)
      continue;
    const lines = Array.isArray(raw.lines)
      ? (raw.lines as Array<Record<string, unknown>>).flatMap((l) => {
          const category =
            typeof l?.category === 'string' ? l.category.trim() : '';
          const c = Math.abs(Math.round(Number(l?.cents)));
          if (!category || !Number.isFinite(c)) return [];
          return [
            {
              category: category.slice(0, 120),
              categoryType:
                typeof l.categoryType === 'string' ? l.categoryType : null,
              cents: c,
            },
          ];
        })
      : [];
    const str = (v: unknown, max = 191): string | null =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
    out.push({
      qboId: str(raw.qboId, 32) ?? '',
      type: raw.type === 'Deposit' ? 'Deposit' : 'Purchase',
      date,
      cents: Math.round(cents),
      bankAccountId: str(raw.bankAccountId, 32),
      bankAccountName: str(raw.bankAccountName),
      payee: str(raw.payee, 100),
      lines,
    });
  }
  return out;
}

/**
 * Which bank row each QuickBooks transaction is: same amount and sign, dates at most
 * `MATCH_DAYS` apart, each row used once, closest date first. When the QuickBooks bank
 * account is known for the row's account (`qboAccountId`, or the same account name) only
 * those rows count; otherwise the match must be the ONLY candidate in the whole book.
 */
export function matchTxns(
  txns: readonly QboHistoryTxn[],
  rows: readonly BookRow[],
): Map<string, BookRow> {
  const byCents = new Map<number, BookRow[]>();
  for (const r of rows) {
    if (!r.date) continue;
    const list = byCents.get(r.cents) ?? [];
    list.push(r);
    byCents.set(r.cents, list);
  }
  const used = new Set<number>();
  const out = new Map<string, BookRow>();
  const ordered = [...txns].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of ordered) {
    const when = dayOf(t.date);
    const near = (byCents.get(t.cents) ?? []).filter(
      (r) =>
        !used.has(r.id) &&
        Math.abs(dayOf(r.date!) - when) <= MATCH_DAYS * DAY_MS,
    );
    if (!near.length) continue;
    const sameAccount = near.filter(
      (r) =>
        (t.bankAccountId && r.qboAccountId === t.bankAccountId) ||
        (t.bankAccountName &&
          r.accountName &&
          nameKey(r.accountName) === nameKey(t.bankAccountName)),
    );
    let pick: BookRow | undefined;
    if (sameAccount.length) {
      pick = sameAccount.sort(
        (a, b) =>
          Math.abs(dayOf(a.date!) - when) - Math.abs(dayOf(b.date!) - when) ||
          a.id - b.id,
      )[0];
    } else if (near.length === 1) {
      pick = near[0];
    }
    if (!pick) continue;
    used.add(pick.id);
    out.set(t.qboId, pick);
  }
  return out;
}

/** The categories of a transaction worth counting (QuickBooks' uncategorized left out). */
function realCategories(t: QboHistoryTxn): string[] {
  return [
    ...new Set(
      t.lines.map((l) => l.category).filter((c) => !UNCATEGORIZED_QBO.test(c)),
    ),
  ];
}

const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The whole analysis. `rules` are the customer's own NAME / DESCRIPTION rules today —
 * a proposal that differs from one of them becomes a question (keep theirs or take
 * QuickBooks'). The firm-wide memories are never asked about: the customer's own rule wins
 * over them anyway.
 */
export function analyze(input: {
  since: string | null;
  txns: readonly QboHistoryTxn[];
  rows: readonly BookRow[];
  rules: readonly ExistingRule[];
}): ImportAnalysis {
  const { txns, rows, rules } = input;
  const matches = matchTxns(txns, rows);

  // ── Payees: their categories, their spellings ──────────────────────────────
  interface PayeeAcc {
    spellings: Map<string, number>;
    categories: Map<string, number>;
    count: number;
  }
  const payees = new Map<string, PayeeAcc>();
  for (const t of txns) {
    if (!t.payee) continue;
    const key = nameKey(t.payee);
    const acc = payees.get(key) ?? {
      spellings: new Map(),
      categories: new Map(),
      count: 0,
    };
    acc.count++;
    acc.spellings.set(t.payee, (acc.spellings.get(t.payee) ?? 0) + 1);
    for (const c of realCategories(t))
      acc.categories.set(c, (acc.categories.get(c) ?? 0) + 1);
    payees.set(key, acc);
  }
  const top = <K>(m: Map<K, number>): K =>
    [...m].sort((a, b) => b[1] - a[1])[0][0];
  const payeeName = (key: string): string => top(payees.get(key)!.spellings);

  // Our names → the payee QuickBooks used for the same transactions.
  const aliasVotes = new Map<
    string,
    { spelling: string; to: Map<string, number> }
  >();
  // Each description → the (payee, category) its matched transactions had.
  const descVotes = new Map<
    string,
    { example: string; outcomes: Map<string, number>; rows: BookRow[] }
  >();
  for (const t of txns) {
    const row = matches.get(t.qboId);
    if (!row || !t.payee) continue;
    const payeeKey = nameKey(t.payee);
    if (row.name && nameKey(row.name) !== payeeKey) {
      const k = nameKey(row.name);
      const v = aliasVotes.get(k) ?? {
        spelling: row.name.trim(),
        to: new Map(),
      };
      v.to.set(payeeKey, (v.to.get(payeeKey) ?? 0) + 1);
      aliasVotes.set(k, v);
    }
    const key = descriptionKey(row.description);
    if (!key) continue;
    const cats = realCategories(t);
    const outcome = `${payeeKey}\u0000${cats.length === 1 ? cats[0] : ''}`;
    const d = descVotes.get(key) ?? {
      example: row.description,
      outcomes: new Map<string, number>(),
      rows: [] as BookRow[],
    };
    d.outcomes.set(outcome, (d.outcomes.get(outcome) ?? 0) + 1);
    d.rows.push(row);
    descVotes.set(key, d);
  }

  // An alias that QuickBooks spelt two ways is left to the description rules.
  const aliasOf = new Map<string, string>(); // our name key → payee key
  for (const [k, v] of aliasVotes) {
    if (v.to.size === 1) aliasOf.set(k, [...v.to.keys()][0]);
  }

  // ── Name proposals ──────────────────────────────────────────────────────────
  const names: NameProposal[] = [];
  const nameIdOf = new Map<string, string>();
  for (const [key, acc] of payees) {
    const categories = [...acc.categories]
      .map(([category, count]) => ({ category, count }))
      .sort(
        (a, b) => b.count - a.count || a.category.localeCompare(b.category),
      );
    const id = `n${names.length + 1}`;
    nameIdOf.set(key, id);
    const aliases = [...aliasOf]
      .filter(([, to]) => to === key)
      .map(([from]) => aliasVotes.get(from)!.spelling)
      .sort((a, b) => a.localeCompare(b));
    names.push({
      id,
      payee: payeeName(key),
      categories,
      category: categories.length === 1 ? categories[0].category : null,
      split: false,
      aliases,
      descriptions: [],
      count: acc.count,
      skip: categories.length === 0 && aliases.length === 0,
    });
  }

  // ── Description proposals (and each payee's one-category descriptions) ────────
  const descriptions: DescriptionProposal[] = [];
  const questions: ImportQuestion[] = [];
  const ask = (q: Omit<ImportQuestion, 'id'>): void => {
    questions.push({ ...q, id: `q${questions.length + 1}` });
  };
  for (const [key, d] of descVotes) {
    const outcomes = [...d.outcomes].sort((a, b) => b[1] - a[1]);
    const payeeKeys = new Set(outcomes.map(([o]) => o.split('\u0000')[0]));
    // A payee's descriptions that always meant one category (for sub-names).
    if (payeeKeys.size === 1) {
      const [only] = payeeKeys;
      const cats = outcomes.map(([o]) => o.split('\u0000')[1]).filter(Boolean);
      const name = names.find((n) => n.id === nameIdOf.get(only));
      if (name && new Set(cats).size === 1 && cats.length === outcomes.length) {
        name.descriptions.push({
          key,
          example: d.example,
          category: cats[0],
          count: d.rows.length,
        });
      }
    }
    // Does the name path already give these rows their QuickBooks payee?
    const reached = d.rows.every((r) => {
      if (!r.name) return false;
      const k = nameKey(r.name);
      return payeeKeys.has(aliasOf.get(k) ?? k);
    });
    if (reached && payeeKeys.size === 1) continue;
    if (payeeKeys.size === 1) {
      const [only] = payeeKeys;
      const cat = outcomes[0][0].split('\u0000')[1] || null;
      descriptions.push({
        id: `d${descriptions.length + 1}`,
        key,
        example: d.example,
        payee: payeeName(only),
        category: cat,
        count: d.rows.length,
        skip: false,
      });
      continue;
    }
    // One description, several payees: which one?
    const byPayee = new Map<string, number>();
    for (const [o, n] of outcomes) {
      const p = o.split('\u0000')[0];
      byPayee.set(p, (byPayee.get(p) ?? 0) + n);
    }
    const choices: Record<string, { payee: string; category: string | null }> =
      {};
    const options = [...byPayee]
      .sort((a, b) => b[1] - a[1])
      .map(([p, n], i) => {
        const value = `c${i + 1}`;
        const cat =
          names.find((x) => x.id === nameIdOf.get(p))?.category ?? null;
        choices[value] = { payee: payeeName(p), category: cat };
        return { value, label: payeeName(p), detail: plural(n, 'transaction') };
      });
    ask({
      kind: 'DESCRIPTION_CONFLICT',
      title: `“${d.example}” went to ${byPayee.size} different payees in QuickBooks. Which one should it be?`,
      detail: null,
      options: [
        ...options,
        { value: SKIP, label: 'No rule for this description' },
      ],
      target: { type: 'description-choice', key, example: d.example },
      choices,
    });
  }

  // ── Mess: one payee, several categories ────────────────────────────────────
  for (const n of names) {
    if (n.categories.length < 2) continue;
    ask({
      kind: 'NAME_CATEGORIES',
      title: `${n.payee} was filed under ${n.categories.length} categories in QuickBooks. Which should it be?`,
      detail:
        'A name has one category in our books. Pick one, or split it into sub-names ' +
        `(one per category) — QuickBooks then gets it as “${n.payee}-mix”.`,
      options: [
        ...n.categories.map((c) => ({
          value: c.category,
          label: c.category,
          detail: plural(c.count, 'transaction'),
        })),
        {
          value: SPLIT,
          label: 'Split into sub-names',
          detail: n.categories
            .map((c) => `${n.payee} - ${c.category}`)
            .join(', '),
        },
        { value: SKIP, label: 'No rule for this name' },
      ],
      target: { type: 'name', id: n.id },
    });
  }

  // ── Conflicts with the customer's own rules ────────────────────────────────
  const nameRules = rules.filter((r) => r.matchType === 'NAME');
  for (const n of names) {
    for (const alias of n.aliases) {
      const theirs = nameRules.find(
        (r) => r.matchKey === nameKey(alias) && r.name,
      );
      if (theirs && nameKey(theirs.name!) !== nameKey(n.payee)) {
        ask({
          kind: 'RULE_CONFLICT',
          title: `Your rule renames “${alias}” to “${theirs.name}”. QuickBooks calls it “${n.payee}”.`,
          detail: null,
          options: [
            { value: OURS, label: `Keep “${theirs.name}”` },
            { value: QBO, label: `Use “${n.payee}”` },
          ],
          target: { type: 'alias', id: n.id, alias },
        });
      }
    }
    if (!n.categories.length) continue;
    const theirs = nameRules.find(
      (r) =>
        r.category &&
        ((r.name && nameKey(r.name) === nameKey(n.payee)) ||
          (!r.name && r.matchKey === nameKey(n.payee))),
    );
    const wanted = n.category ?? n.categories[0].category;
    if (theirs && theirs.category!.toLowerCase() !== wanted.toLowerCase()) {
      ask({
        kind: 'RULE_CONFLICT',
        title: `Your rule files ${n.payee} under “${theirs.category}”. QuickBooks used “${wanted}”.`,
        detail:
          n.categories.length > 1
            ? 'If you keep yours, the category question for this name is not used.'
            : null,
        options: [
          { value: OURS, label: `Keep “${theirs.category}”` },
          { value: QBO, label: `Use QuickBooks' category` },
        ],
        target: { type: 'name-category', id: n.id },
      });
    }
  }
  for (const d of descriptions) {
    const theirs = rules.find(
      (r) => r.matchType === 'DESCRIPTION' && r.matchKey === d.key && r.name,
    );
    if (theirs && nameKey(theirs.name!) !== nameKey(d.payee)) {
      ask({
        kind: 'RULE_CONFLICT',
        title: `Your rule names “${d.example}” “${theirs.name}”. QuickBooks used “${d.payee}”.`,
        detail: null,
        options: [
          { value: OURS, label: `Keep “${theirs.name}”` },
          { value: QBO, label: `Use “${d.payee}”` },
        ],
        target: { type: 'description', id: d.id },
      });
    }
  }

  // ── Categories ─────────────────────────────────────────────────────────────
  const categories = new Map<string, string | null>();
  for (const t of txns)
    for (const l of t.lines)
      if (!categories.has(l.category))
        categories.set(l.category, l.categoryType);

  return {
    since: input.since,
    stats: {
      qboTransactions: txns.length,
      bookRows: rows.length,
      matched: matches.size,
      payees: payees.size,
    },
    names: names.sort(
      (a, b) => b.count - a.count || a.payee.localeCompare(b.payee),
    ),
    descriptions,
    questions,
    categories: [...categories].map(([name, type]) => ({ name, type })),
    matches: [...matches].map(([qboId, row]) => ({
      qboId,
      transactionId: row.id,
      category: row.category,
      splits: [],
    })),
  };
}

/** Our account type for a QuickBooks AccountType. */
export function accountTypeOf(
  qboType: string | null,
): 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE' {
  const t = (qboType ?? '').toLowerCase();
  if (/income/.test(t)) return 'INCOME';
  if (/equity/.test(t)) return 'EQUITY';
  if (/(credit card|liabilit|payable)/.test(t)) return 'LIABILITY';
  if (/(bank|asset|receivable)/.test(t)) return 'ASSET';
  return 'EXPENSE';
}

/** Is this QuickBooks account one of its "no category" ones? */
export const isUncategorizedQbo = (name: string): boolean =>
  UNCATEGORIZED_QBO.test(name.trim());
