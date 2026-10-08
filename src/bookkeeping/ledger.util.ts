import { normalizeAccount } from './chart-of-accounts';

/** What the AI extracts for one statement line. */
export interface ExtractedTransaction {
  pendingDate: string | null;
  postingDate: string | null;
  description: string;
  /** The payee / payer the AI read out of the description, or null. */
  name?: string | null;
  /** Signed: > 0 money INTO the bank account, < 0 money OUT. */
  amount: number;
  /** The running balance printed on the row, if the statement has that column. */
  balanceAfter: number | null;
  offsetAccount: string;
  /** 0-based page (chunk) the row was read from; set when pages are assembled. */
  page?: number;
}

/** One ledger row, ready for `BankTransaction`. */
export interface LedgerRow {
  position: number;
  pendingDate: Date | null;
  postingDate: Date | null;
  description: string;
  name: string | null;
  /** Rounded to cents, as a string so Prisma's Decimal never sees a float error. */
  amount: string;
  balanceAfter: string | null;
  offsetAccount: string;
  debitAccount: string;
  creditAccount: string;
}

/**
 * The double entry for one bank line — decided in CODE, never by the AI.
 *
 * The bank account is an ASSET, so (the bookkeeping table the firm works from):
 *  - money IN  (amount > 0): the asset increases → DEBIT bank,   CREDIT the offset;
 *  - money OUT (amount < 0): the asset decreases → CREDIT bank,  DEBIT the offset.
 * A refund from a vendor (+) therefore credits the expense it reverses, which is right.
 * A zero amount is treated as money in; it moves nothing either way.
 */
export function doubleEntry(
  amount: number,
  bankAccount: string,
  offsetAccount: string,
): { debitAccount: string; creditAccount: string } {
  return amount < 0
    ? { debitAccount: offsetAccount, creditAccount: bankAccount }
    : { debitAccount: bankAccount, creditAccount: offsetAccount };
}

/**
 * A date the model wrote, as a UTC midnight Date, or null. Accepts ISO `YYYY-MM-DD`
 * only — the schema asks for exactly that, and guessing at `03/04` (March or April?)
 * would silently put a transaction in the wrong month.
 */
export function parseIsoDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Reject rollovers like 2026-02-31, which Date would quietly turn into March 3rd.
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}

/** Cents-exact string for a model-supplied number; null for anything not finite. */
export function toMoney(raw: unknown): string | null {
  const n = typeof raw === 'string' ? Number(raw.replace(/[$,\s]/g, '')) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Extracted lines → ledger rows. Lines without a usable amount are dropped (a header or
 * a running-balance line the model misread); everything else is kept in statement order.
 */
export function buildLedgerRows(
  lines: ExtractedTransaction[],
  bankAccount: string,
): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const line of lines) {
    const amount = toMoney(line.amount);
    if (amount === null) continue;
    const offset = normalizeAccount(line.offsetAccount);
    rows.push({
      position: rows.length,
      pendingDate: parseIsoDate(line.pendingDate),
      postingDate: parseIsoDate(line.postingDate),
      description:
        (line.description || '').trim().slice(0, 512) || '(no description)',
      name: (line.name ?? '').trim().slice(0, 191) || null,
      amount,
      balanceAfter:
        line.balanceAfter === null || line.balanceAfter === undefined
          ? null
          : toMoney(line.balanceAfter),
      offsetAccount: offset,
      ...doubleEntry(Number(amount), bankAccount, offset),
    });
  }
  return rows;
}
