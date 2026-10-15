import {
  CHART_OF_ACCOUNTS,
  typeFor,
  type TypeContext,
} from './chart-of-accounts';
import { cents } from './reconcile.util';
import { UNCLARIFIED_NAME } from './reports.util';

export type TaxKind = 'SALES' | 'PURCHASE';

/**
 * An ACTIVE agency: its rate per kind, a percent (10 = 10%). A kind it has no rate for,
 * it never taxes.
 */
export interface Agency {
  id: number;
  name: string;
  rates: Partial<Record<TaxKind, number>>;
}

export const TYPE_OF = new Map(CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));

/**
 * Which kind of tax a row can carry, from its category's type for this customer
 * (`typeFor`: their own move, their own category, the chart): income → sales tax,
 * expense (Uncategorized included) → purchase tax. Balance-sheet offsets — transfers,
 * card and loan payments, owner money, tax agencies — are never taxed.
 */
export function kindOf(
  offsetAccount: string,
  ctx: TypeContext = {},
): TaxKind | null {
  const type = typeFor(offsetAccount, ctx);
  if (type === 'INCOME') return 'SALES';
  if (type === 'EXPENSE') return 'PURCHASE';
  return null;
}

export const rateFor = (agency: Agency, kind: TaxKind): number | undefined =>
  agency.rates[kind];

export const fits = (agency: Agency, kind: TaxKind): boolean =>
  rateFor(agency, kind) !== undefined;

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

/** The key a payee's agencies are stored under: lower-cased, "Unclarified name" for none. */
export const nameTaxKey = (name: string | null | undefined): string =>
  (name?.trim() || UNCLARIFIED_NAME).toLowerCase();

/** A ledger row (or split) as the per-name tax sees it; `amount` is what is left of it. */
export interface NameTaxRow {
  id: number;
  name: string | null;
  offsetAccount: string;
  amount: number;
}

/** One tax on one row, before it is split out of the bank amount (`taxSplit`). */
export interface NameTax {
  agencyId: number;
  agency: string;
  kind: TaxKind;
  rate: number;
}

/**
 * Which agencies tax which rows — decided by the row's NAME, with no AI (user's decision
 * 2026-10-14). Each agency picked for the name (`agenciesOf`, keyed `nameTaxKey`) that has
 * a rate for the row's kind gives it one line: a Customer (income) row takes the SALES
 * rate, a Supplier (expense) row the PURCHASE rate; balance-sheet rows are never taxed. A
 * name with no agencies is not taxed — the default. A fully split row (nothing left) gets
 * none: its splits carry their own. Lines follow the agencies' order (oldest first).
 */
export function nameTaxLines(
  rows: readonly NameTaxRow[],
  agenciesOf: ReadonlyMap<string, readonly number[]>,
  agencies: readonly Agency[],
  ctx: TypeContext = {},
): Map<number, NameTax[]> {
  const out = new Map<number, NameTax[]>();
  if (!agenciesOf.size || !agencies.length) return out;
  for (const r of rows) {
    if (cents(r.amount) === 0) continue;
    const picked = agenciesOf.get(nameTaxKey(r.name));
    if (!picked?.length) continue;
    const kind = kindOf(r.offsetAccount, ctx);
    if (!kind) continue;
    const lines = agencies
      .filter((a) => picked.includes(a.id) && fits(a, kind))
      .map((a) => ({
        agencyId: a.id,
        agency: a.name,
        kind,
        rate: rateFor(a, kind)!,
      }));
    if (lines.length) out.set(r.id, lines);
  }
  return out;
}
