/**
 * Which bank account a statement belongs to.
 *
 * ⚠️ An account IS its name: the ledger rows, the reports, the starting-balance chains and
 * the "Move to…" overrides all group by the exact `accountName` string. That name is the
 * AI's free text ("bank name plus the last 4 digits"), and on TD statements — which print
 * the full 7-digit number — gpt-4o wrote "TD Canada Trust 5234" on some statements and
 * "TD Canada Trust 5234496" on others. One account became two on the balance sheet, each
 * with its own starting-balance chain (2026-10-15).
 *
 * So the name is not trusted as an identity. A statement joins an account the customer
 * already has when it is the same bank text, the same kind (bank vs card), and the digits
 * agree: one is a prefix or a suffix of the other, at least 4 digits long. Anything
 * ambiguous (it fits two existing accounts) keeps its own name rather than guessing — a
 * wrong merge mixes two real accounts, which is worse than a split.
 */

/** The shortest digit run that can identify an account (a "last 4"). */
const MIN_DIGITS = 4;

export interface KnownAccount {
  name: string;
  /** BANK | CREDIT_CARD; null = read before it was recorded (treated as BANK). */
  kind: string | null;
}

/** "TD Canada Trust 5234-496" → "td canada trust": the name without its digits. */
export function bankTextOf(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every digit in the name, in order ("BMO 2304" → "2304"); '' when there are none. */
export function digitsOf(name: string): string {
  return name.replace(/\D/g, '');
}

/** True when the two digit strings name the same account (prefix or suffix, ≥ 4 digits). */
export function sameAccountDigits(a: string, b: string): boolean {
  if (a.length < MIN_DIGITS || b.length < MIN_DIGITS) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.startsWith(short) || long.endsWith(short);
}

const kindOf = (k: string | null | undefined) => (k === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'BANK');

/** Same bank text, same kind, agreeing digits. */
export function isSameAccount(
  a: { name: string; kind: string | null; digits?: string | null },
  b: { name: string; kind: string | null; digits?: string | null },
): boolean {
  return (
    kindOf(a.kind) === kindOf(b.kind) &&
    bankTextOf(a.name) !== '' &&
    bankTextOf(a.name) === bankTextOf(b.name) &&
    sameAccountDigits(a.digits || digitsOf(a.name), b.digits || digitsOf(b.name))
  );
}

/**
 * The name a freshly read statement is filed under.
 *
 * - It matches exactly one account the customer already has → that account's name.
 * - It matches none, and the full number is known → "<bank text> <last 4>", the name the
 *   prompt asks for (the model sometimes writes the first digits or the whole number).
 * - Otherwise (no name, no digits, or ambiguous) → the AI's own name, unchanged.
 */
export function canonicalAccountName(
  read: { accountName: string | null; accountNumber?: string | null; accountKind: string | null },
  existing: KnownAccount[],
): string | null {
  const name = read.accountName?.trim() || null;
  if (!name) return null;
  const number = read.accountNumber && read.accountNumber.length >= MIN_DIGITS ? read.accountNumber : null;
  const me = { name, kind: read.accountKind, digits: number ?? digitsOf(name) };

  if (existing.some((e) => e.name === name && kindOf(e.kind) === kindOf(me.kind))) return name;

  const matches = [...new Set(existing.filter((e) => isSameAccount(me, e)).map((e) => e.name))];
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return name;

  // A new account: file it under the name the prompt asks for, from the real number.
  if (number) {
    const text = name.replace(/[\d\s-]+$/g, '').trim() || name;
    return `${text} ${number.slice(-MIN_DIGITS)}`;
  }
  return name;
}

/**
 * Groups of names that are one account (for the backfill), each with the name to keep.
 * `counts` = statements per name; the name used by the most statements is kept. A name
 * that fits two groups that do not fit each other is left alone (ambiguous).
 */
export function mergeGroups(
  accounts: (KnownAccount & { statements: number })[],
): { keep: string; merge: string[] }[] {
  const n = accounts.length;
  const same = (i: number, j: number) => isSameAccount(accounts[i], accounts[j]);
  const parent = accounts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (same(i, j)) parent[find(i)] = find(j);
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) groups.set(find(i), [...(groups.get(find(i)) ?? []), i]);

  const out: { keep: string; merge: string[] }[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // Every pair must agree, or "5234" would chain "5234496" and "5234871" (two accounts).
    const consistent = members.every((i) => members.every((j) => i === j || same(i, j)));
    if (!consistent) continue;
    const sorted = [...members].sort(
      (a, b) =>
        accounts[b].statements - accounts[a].statements ||
        accounts[a].name.length - accounts[b].name.length,
    );
    out.push({
      keep: accounts[sorted[0]].name,
      merge: sorted.slice(1).map((i) => accounts[i].name),
    });
  }
  return out;
}
