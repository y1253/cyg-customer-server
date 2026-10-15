import { type TypeContext } from './chart-of-accounts';
export type TaxKind = 'SALES' | 'PURCHASE';
export interface Agency {
    id: number;
    name: string;
    rates: Partial<Record<TaxKind, number>>;
}
export declare const TYPE_OF: Map<string, import("./chart-of-accounts").AccountType>;
export declare function kindOf(offsetAccount: string, ctx?: TypeContext): TaxKind | null;
export declare const rateFor: (agency: Agency, kind: TaxKind) => number | undefined;
export declare const fits: (agency: Agency, kind: TaxKind) => boolean;
export declare function includedTaxes(amount: number, rates: readonly number[]): number[];
export declare const taxAmount: (amount: number, rate: number) => number;
export interface SplitEntry {
    amount: number;
    offsetAccount: string;
    debitAccount: string;
    creditAccount: string;
}
export declare function taxSplit<E extends SplitEntry>(parent: E, lines: Array<{
    agency: string;
    rate: number;
}>): {
    parent: E;
    taxes: SplitEntry[];
};
export declare const nameTaxKey: (name: string | null | undefined) => string;
export interface NameTaxRow {
    id: number;
    name: string | null;
    offsetAccount: string;
    amount: number;
}
export interface NameTax {
    agencyId: number;
    agency: string;
    kind: TaxKind;
    rate: number;
}
export declare function nameTaxLines(rows: readonly NameTaxRow[], agenciesOf: ReadonlyMap<string, readonly number[]>, agencies: readonly Agency[], ctx?: TypeContext): Map<number, NameTax[]>;
