import { FX_GAIN_LOSS } from './chart-of-accounts';
import { doubleEntry } from './ledger.util';
import { cents } from './reconcile.util';

export { FX_GAIN_LOSS };

/**
 * The currencies the Bank of Canada publishes a daily rate for (Valet series FX<CUR>CAD),
 * plus CAD itself. A home or statement currency must be one of these.
 */
export const FX_CURRENCIES = [
  'CAD',
  'USD',
  'EUR',
  'GBP',
  'AUD',
  'BRL',
  'CHF',
  'CNY',
  'HKD',
  'IDR',
  'INR',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PEN',
  'SAR',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'TWD',
  'VND',
  'ZAR',
] as const;

export const isFxCurrency = (c: string | null | undefined): boolean =>
  !!c && (FX_CURRENCIES as readonly string[]).includes(c);

/** YYYY-MM-DD → CAD per one unit, for ONE currency, as published (business days only). */
export type RateSeries = ReadonlyArray<{ date: string; cadPer: number }>;

/**
 * CAD per unit of `currency` on `date`: that day's published rate, else the latest one
 * before it (weekends, holidays). CAD is 1. Null when nothing at or before the date is known.
 * `series` must be sorted by date.
 */
export function cadPerOn(
  currency: string,
  date: string,
  series: RateSeries | undefined,
): number | null {
  if (currency === 'CAD') return 1;
  if (!series?.length) return null;
  let lo = 0;
  let hi = series.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= date) {
      hit = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return hit >= 0 ? series[hit].cadPer : null;
}

/**
 * The rate from `from` to `home` on `date` — through CAD, since every Bank of Canada rate
 * is against CAD (USD→EUR = USD→CAD ÷ EUR→CAD). 1 for the same currency; null when a rate
 * is missing.
 */
export function rateOn(
  from: string,
  home: string,
  date: string,
  seriesOf: (currency: string) => RateSeries | undefined,
): number | null {
  if (from === home) return 1;
  const a = cadPerOn(from, date, seriesOf(from));
  const b = cadPerOn(home, date, seriesOf(home));
  if (a === null || b === null || b === 0) return null;
  return a / b;
}

/** `amount` in the home currency at `rate`, rounded to the cent. */
export const toHome = (amount: number, rate: number): number =>
  Math.round(cents(amount) * rate) / 100 + 0;

/** A foreign statement account's activity, oldest statement first (see `revaluationRows`). */
export interface FxStatement {
  statementId: number;
  bankAccount: string;
  /** The statement's last day — where its balance is revalued. */
  periodEnd: string | null;
  /** Σ of its rows (Starting balance included), in the STATEMENT's currency. */
  foreign: number;
  /** Σ of the same rows converted, each at its own day's rate. */
  home: number;
  /** foreign → home on `periodEnd`; null = no rate known (no revaluation then). */
  closingRate: number | null;
}

/** One revaluation row — computed on READ, never stored, like the Starting balance rows. */
export interface FxRow {
  statementId: number;
  bankAccount: string;
  date: string;
  /** Always 0: the foreign balance does not move. */
  amount: 0;
  /** The home-currency difference, signed from the bank side (> 0 = a gain). */
  homeAmount: number;
  rate: number;
  offsetAccount: string;
  debitAccount: string;
  creditAccount: string;
}

/**
 * At the end of every foreign statement, the account's balance must equal, in the home
 * currency, its foreign balance at THAT day's rate (user's request 2026-10-14). Each row
 * was converted at its own day's rate, so the two drift apart as the rate moves; the
 * difference is posted as a row of 0 in the foreign currency, with the home-currency
 * difference offset to Exchange Gain or Loss. Statements are taken in `periodEnd` order per
 * account; each revaluation counts toward the next.
 */
export function revaluationRows(statements: readonly FxStatement[]): FxRow[] {
  const byAccount = new Map<string, FxStatement[]>();
  for (const s of statements) {
    byAccount.set(s.bankAccount, [...(byAccount.get(s.bankAccount) ?? []), s]);
  }
  const out: FxRow[] = [];
  for (const [bankAccount, list] of byAccount) {
    list.sort(
      (a, b) =>
        (a.periodEnd ?? '').localeCompare(b.periodEnd ?? '') ||
        a.statementId - b.statementId,
    );
    let foreign = 0;
    let home = 0;
    for (const s of list) {
      foreign += cents(s.foreign);
      home += cents(s.home);
      if (!s.periodEnd || s.closingRate === null) continue;
      const target = Math.round(foreign * s.closingRate);
      const diff = target - home;
      if (diff === 0) continue;
      home += diff;
      const homeAmount = diff / 100;
      out.push({
        statementId: s.statementId,
        bankAccount,
        date: s.periodEnd,
        amount: 0,
        homeAmount,
        rate: s.closingRate,
        offsetAccount: FX_GAIN_LOSS,
        ...doubleEntry(homeAmount, bankAccount, FX_GAIN_LOSS),
      });
    }
  }
  return out;
}
