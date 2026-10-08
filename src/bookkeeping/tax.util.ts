import { CHART_OF_ACCOUNTS } from './chart-of-accounts';
import { cents } from './reconcile.util';

export type AgencyType = 'SALES' | 'PURCHASE' | 'BOTH';
export type TaxKind = 'SALES' | 'PURCHASE';

/** An ACTIVE agency, as the tax step sees it. `rate` is a percent (10 = 10%). */
export interface Agency {
  id: number;
  name: string;
  type: AgencyType;
  rate: number;
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

const TYPE_OF = new Map(CHART_OF_ACCOUNTS.map((a) => [a.name, a.type]));

/**
 * Which kind of tax a row can carry, from its category alone: income → sales tax,
 * expense (Uncategorized included) → purchase tax. Balance-sheet offsets — transfers,
 * card and loan payments, owner money — are never taxed, and neither is an account no
 * longer in the chart.
 */
export function kindOf(offsetAccount: string): TaxKind | null {
  const type = TYPE_OF.get(offsetAccount);
  if (type === 'INCOME') return 'SALES';
  if (type === 'EXPENSE') return 'PURCHASE';
  return null;
}

export const fits = (agency: Agency, kind: TaxKind): boolean =>
  agency.type === 'BOTH' || agency.type === kind;

/** The rows worth asking the AI about: a taxable kind with at least one agency of it. */
export function candidates(
  rows: TaxableRow[],
  agencies: Agency[],
): TaxCandidate[] {
  return rows.flatMap((r) => {
    const kind = kindOf(r.offsetAccount);
    return kind && agencies.some((a) => fits(a, kind)) ? [{ ...r, kind }] : [];
  });
}

/** |amount| × rate%, in whole cents — "on top", the customer's choice: $100 at 10% = $10. */
export const taxAmount = (amount: number, rate: number): number =>
  Math.round((Math.abs(cents(amount)) * rate) / 100) / 100;

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
    for (const agencyId of v.agencyIds) {
      const agency = agencyOf.get(agencyId);
      const key = `${row.id}:${agencyId}`;
      if (!agency || !fits(agency, row.kind) || seen.has(key)) continue;
      seen.add(key);
      const amount = taxAmount(row.amount, agency.rate);
      if (amount === 0) continue;
      out.push({
        transactionId: row.id,
        agencyId,
        kind: row.kind,
        rate: agency.rate,
        amount,
      });
    }
  }
  return out;
}

/**
 * The double entry of a tax row. The agency is a liability:
 *  - sales:    DEBIT the income account, CREDIT the agency (tax collected is owed);
 *  - purchase: DEBIT the agency, CREDIT the expense account (tax paid is claimed back).
 */
export function taxEntry(
  kind: TaxKind,
  offsetAccount: string,
  agency: string,
): { debitAccount: string; creditAccount: string } {
  return kind === 'SALES'
    ? { debitAccount: offsetAccount, creditAccount: agency }
    : { debitAccount: agency, creditAccount: offsetAccount };
}

/**
 * The same entry for the reports, which count every row from the bank's side
 * (+ = credit the offset). A tax row has no bank side, so it is two rows with no bank.
 */
export function taxReportRows(
  kind: TaxKind,
  offsetAccount: string,
  agency: string,
  amount: number,
): Array<{ amount: number; offsetAccount: string }> {
  const s = kind === 'SALES' ? 1 : -1;
  return [
    { amount: s * amount, offsetAccount: agency },
    { amount: -s * amount, offsetAccount: offsetAccount },
  ];
}

/** Puts each parent's tax rows directly after it, whatever order the parents are in. */
export function withTaxRows<P, C>(
  parents: P[],
  childrenOf: (p: P) => C[] | undefined,
): Array<P | C> {
  return parents.flatMap((p) => [p, ...(childrenOf(p) ?? [])]);
}
