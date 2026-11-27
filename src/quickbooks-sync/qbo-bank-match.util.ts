/**
 * step11 part 3 (2026-11-26) — the pure rules for finding a connected bank's account that
 * QuickBooks already has: candidates by NAME (same kind, its last 4 digits, the bank's words),
 * proven by comparing TRANSACTIONS (same cents and sign, at most 3 days apart). User's
 * request: "check in QuickBooks if the account exists (by its name, verified by comparing
 * transactions) — then no new account is added".
 */

export interface OurBankAccount {
  /** Our folder name ("TD 4562"). */
  accountName: string;
  /** Plaid's last digits. */
  mask: string | null;
  institution: string | null;
  kind: 'BANK' | 'CREDIT_CARD';
}

export interface QboBankAccount {
  id: string;
  name: string;
  acctNum: string | null;
  /** QuickBooks' AccountType ("Bank", "Credit Card"). */
  type: string;
}

/** A dated amount: + = money in, − = money out, in cents. */
export interface DatedCents {
  date: string;
  cents: number;
}

/** Words of a bank's name that tell nothing apart. */
const GENERIC = new Set([
  'bank',
  'the',
  'of',
  'and',
  'canada',
  'trust',
  'financial',
  'credit',
  'union',
  'card',
  'account',
  'chequing',
  'checking',
  'savings',
  'visa',
  'mastercard',
  'business',
]);

const norm = (v: string): string =>
  v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const words = (v: string | null): string[] =>
  norm(v ?? '')
    .split(' ')
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !GENERIC.has(w));

/** Our account's last 4 digits: Plaid's mask, else the digits the folder name ends with. */
export function lastDigits(ours: OurBankAccount): string | null {
  const mask = (ours.mask ?? '').replace(/\D/g, '');
  if (mask.length >= 4) return mask.slice(-4);
  const m = /(\d{4})\D*$/.exec(ours.accountName);
  return m ? m[1] : null;
}

/** Same kind of account: a Plaid bank account ↔ "Bank", a card ↔ "Credit Card". */
export function sameKind(
  ours: OurBankAccount,
  theirs: QboBankAccount,
): boolean {
  return ours.kind === 'CREDIT_CARD'
    ? theirs.type === 'Credit Card'
    : theirs.type === 'Bank';
}

/**
 * How much the NAME says it is the same account: 10 = the same name, +5 = its last 4
 * digits in their name or account number, +2 = a word of the bank's name. −1 = another
 * kind of account (never a candidate); 0 = the same kind, nothing more.
 */
export function nameScore(
  ours: OurBankAccount,
  theirs: QboBankAccount,
): number {
  if (!sameKind(ours, theirs)) return -1;
  let score = 0;
  if (norm(ours.accountName) === norm(theirs.name)) score += 10;
  const last4 = lastDigits(ours);
  if (last4) {
    const digits = theirs.name.replace(/\D/g, '');
    const num = (theirs.acctNum ?? '').replace(/\D/g, '');
    if (digits.endsWith(last4) || digits.includes(last4) || num.endsWith(last4))
      score += 5;
  }
  const theirWords = new Set(words(theirs.name));
  const bankWords = [...words(ours.institution), ...words(ours.accountName)];
  if (bankWords.some((w) => theirWords.has(w))) score += 2;
  return score;
}

const dayOf = (iso: string): number =>
  Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/**
 * How many of OUR rows QuickBooks has (same cents and sign, at most 3 days apart, closest
 * first, each of theirs used once). `compared` = our rows.
 */
export function verifyMatch(
  ours: readonly DatedCents[],
  theirs: readonly DatedCents[],
): { matched: number; compared: number } {
  const pool = new Map<number, number[]>();
  for (const t of theirs) {
    const list = pool.get(t.cents);
    if (list) list.push(dayOf(t.date));
    else pool.set(t.cents, [dayOf(t.date)]);
  }
  let matched = 0;
  for (const o of ours) {
    const list = pool.get(o.cents);
    if (!list?.length) continue;
    const d = dayOf(o.date);
    let best = -1;
    for (let i = 0; i < list.length; i++) {
      const gap = Math.abs(list[i] - d);
      if (gap <= 3 && (best < 0 || gap < Math.abs(list[best] - d))) best = i;
    }
    if (best >= 0) {
      list.splice(best, 1);
      matched++;
    }
  }
  return { matched, compared: ours.length };
}

/**
 * Is it the same account? With the name pointing at it (score > 0): 3 of our rows found
 * there and half of them. With only the kind (score 0): 5 and 70 %. With nothing to compare
 * (no rows on either side), only the same name (score ≥ 10).
 */
export function acceptMatch(
  score: number,
  v: { matched: number; compared: number },
  theirCount: number,
): boolean {
  if (score < 0) return false;
  if (!v.compared || !theirCount) return score >= 10;
  const ratio = v.matched / v.compared;
  if (score > 0) return v.matched >= 3 && ratio >= 0.5;
  return v.matched >= 5 && ratio >= 0.7;
}

/** The candidates worth checking, best name first (at most `max`). */
export function candidatesFor(
  ours: OurBankAccount,
  theirs: readonly QboBankAccount[],
  max = 3,
): Array<{ account: QboBankAccount; score: number }> {
  return theirs
    .map((account) => ({ account, score: nameScore(ours, account) }))
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}
