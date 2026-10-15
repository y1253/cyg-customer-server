import { FX_GAIN_LOSS } from './chart-of-accounts';
export { FX_GAIN_LOSS };
export declare const FX_CURRENCIES: readonly ["CAD", "USD", "EUR", "GBP", "AUD", "BRL", "CHF", "CNY", "HKD", "IDR", "INR", "JPY", "KRW", "MXN", "MYR", "NOK", "NZD", "PEN", "SAR", "SEK", "SGD", "THB", "TRY", "TWD", "VND", "ZAR"];
export declare const isFxCurrency: (c: string | null | undefined) => boolean;
export type RateSeries = ReadonlyArray<{
    date: string;
    cadPer: number;
}>;
export declare function cadPerOn(currency: string, date: string, series: RateSeries | undefined): number | null;
export declare function rateOn(from: string, home: string, date: string, seriesOf: (currency: string) => RateSeries | undefined): number | null;
export declare const toHome: (amount: number, rate: number) => number;
export interface FxStatement {
    statementId: number;
    bankAccount: string;
    periodEnd: string | null;
    foreign: number;
    home: number;
    closingRate: number | null;
}
export interface FxRow {
    statementId: number;
    bankAccount: string;
    date: string;
    amount: 0;
    homeAmount: number;
    rate: number;
    offsetAccount: string;
    debitAccount: string;
    creditAccount: string;
}
export declare function revaluationRows(statements: readonly FxStatement[]): FxRow[];
