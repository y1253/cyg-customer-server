import { CHART_OF_ACCOUNTS } from './chart-of-accounts';
import { cents } from './reconcile.util';

export type TaxKind = 'SALES' | 'PURCHASE';

/**
 * An ACTIVE agency, as the tax step sees it: its rate per kind, a percent (10 = 10%).
 * A kind it has no rate for, it never taxes.
 */
export interface Agency {
  id: number;
  name: string;
  rates: Partial<Record<TaxKind, number>>;
}

/** A ledger row the AI may tax. */
export interface TaxableRow {
  id: number;
  description: string;
  name: string | null;
  amount: number;
  offsetAccount: string;
}

export interface TaxCandidate extends TaxableRow {
  kind: TaxKind;
}

/** One stored verdict, ready for `TransactionTax`. */
export interface TaxLine {
  transactionId: number;
  agencyId: number;
  kind: TaxKind;
  rate: number;
  /** Always positive, rounded to cents. */
  amount: number;
}

export const TYPE_OF = new Map(CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));

/**
 * Which kind of tax a row can carry, from its category alone: income → sales tax,
 * expense (Uncategorized included) → purchase tax. Balance-sheet offsets — transfers,
 * card and loan payments, owner money — are never taxed, and neither is an account no
 * longer in the chart.
 */
export function kindOf(
  offsetAccount: string,
  customTypes?: ReadonlyMap<string, string>,
): TaxKind | null {
  const type = TYPE_OF.get(offsetAccount) ?? customTypes?.get(offsetAccount);
  if (type === 'INCOME') return 'SALES';
  if (type === 'EXPENSE') return 'PURCHASE';
  return null;
}

export const rateFor = (agency: Agency, kind: TaxKind): number | undefined =>
  agency.rates[kind];

export const fits = (agency: Agency, kind: TaxKind): boolean =>
  rateFor(agency, kind) !== undefined;

/** The rows worth asking the AI about: a taxable kind with at least one agency of it. */
export function candidates(
  rows: TaxableRow[],
  agencies: Agency[],
  /** The customer's own categories: an INCOME one is a sale, an EXPENSE one a purchase. */
  customTypes?: ReadonlyMap<string, string>,
): TaxCandidate[] {
  return rows.flatMap((r) => {
    const kind = kindOf(r.offsetAccount, customTypes);
    return kind && agencies.some((a) => fits(a, kind)) ? [{ ...r, kind }] : [];
  });
}

/**
 * The taxes INCLUDED in a bank amount, one per rate, as positive cents-exact numbers.
 *
 * The customer's choice (2026-10-11, reversing "on top" the same day): the bank amount is
 * the price WITH tax, so $100 at 10% is $90.91 + $9.09. With several agencies on one row
 * (GST + QST) each takes |amount| × rateᵢ / (100 + Σrates). Rounding happens in cents and
 * the last line absorbs the remainder of the combined tax, so the row and its taxes always
 * add back to the bank amount to the cent.
 */
export function includedTaxes(
  amount: number,
  rates: readonly number[],
): number[] {
  const total = rates.reduce((n, r) => n + r, 0);
  if (!rates.length || total <= 0) return rates.map(() => 0);
  const base = Math.abs(cents(amount));
  const allTax = Math.round((base * total) / (100 + total));
  const out = rates.map((r) => Math.round((base * r) / (100 + total)));
  const drift = allTax - out.reduce((n, c) => n + c, 0);
  out[out.length - 1] += drift;
  return out.map((c) => c / 100);
}

/** The tax included in `amount` at `rate` alone (one agency on the row). */
export const taxAmount = (amount: number, rate: number): number =>
  includedTaxes(amount, [rate])[0];

/**
 * The AI's verdicts as tax lines. Anything it should not have said is dropped: an unknown
 * row or agency id, an agency of the wrong kind, a repeat, or a zero amount.
 */
export function taxLines(
  rows: TaxCandidate[],
  verdicts: Array<{ id: number; agencyIds: number[] }>,
  agencies: Agency[],
): TaxLine[] {
  const rowOf = new Map(rows.map((r) => [r.id, r]));
  const agencyOf = new Map(agencies.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const out: TaxLine[] = [];
  for (const v of verdicts) {
    const row = rowOf.get(v.id);
    if (!row) continue;
    // Every agency on the row first: an included tax depends on the row's TOTAL rate.
    const picked: Array<{ agencyId: number; rate: number }> = [];
    for (const agencyId of v.agencyIds) {
      const agency = agencyOf.get(agencyId);
      const key = `${row.id}:${agencyId}`;
      if (!agency || !fits(agency, row.kind) || seen.has(key)) continue;
      seen.add(key);
      picked.push({ agencyId, rate: rateFor(agency, row.kind)! });
    }
    const amounts = includedTaxes(
      row.amount,
      picked.map((p) => p.rate),
    );
    picked.forEach((p, i) => {
      if (amounts[i] === 0) return;
      out.push({
        transactionId: row.id,
        agencyId: p.agencyId,
        kind: row.kind,
        rate: p.rate,
        amount: amounts[i],
      });
    });
  }
  return out;
}

/** A ledger entry as the tax split sees it: the bank side is the one that is not the offset. */
export interface SplitEntry {
  amount: number;
  offsetAccount: string;
  debitAccount: string;
  creditAccount: string;
}

/**
 * Splits a taxed bank row into the row WITHOUT its tax and one line per agency, the tax
 * INCLUDED in the bank amount (`includedTaxes`): a $100 sale at 10% becomes a $90.91 sale
 * and a $9.09 tax line, which add back to the $100 the bank moved — so the ledger total
 * matches the statement again. Amounts come from each line's RATE, never a stored amount,
 * so rows tagged while tax was still "on top" read correctly with no migration.
 * Each tax line keeps the row's bank side and puts the agency where the row's own account was:
 *  - sales:    DEBIT the bank, CREDIT the agency (tax collected is owed);
 *  - purchase: DEBIT the agency, CREDIT the bank (tax paid is claimed back).
 */
export function taxSplit<E extends SplitEntry>(
  parent: E,
  lines: Array<{ agency: string; rate: number }>,
): { parent: E; taxes: SplitEntry[] } {
  if (!lines.length) return { parent, taxes: [] };
  const sign = parent.amount < 0 ? -1 : 1;
  const swap = (account: string, agency: string) =>
    account === parent.offsetAccount ? agency : account;
  const amounts = includedTaxes(
    parent.amount,
    lines.map((t) => t.rate),
  );
  const taxes = lines.map((t, i) => ({
    amount: sign * amounts[i],
    offsetAccount: t.agency,
    debitAccount: swap(parent.debitAccount, t.agency),
    creditAccount: swap(parent.creditAccount, t.agency),
  }));
  const taxCents = amounts.reduce((n, a) => n + Math.round(a * 100), 0);
  const net = (cents(parent.amount) - sign * taxCents) / 100;
  return { parent: { ...parent, amount: net }, taxes };
}
