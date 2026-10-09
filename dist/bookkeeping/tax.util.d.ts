export type AgencyType = 'SALES' | 'PURCHASE' | 'BOTH';
export type TaxKind = 'SALES' | 'PURCHASE';
export interface Agency {
    id: number;
    name: string;
    type: AgencyType;
    rate: number;
}
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
export interface TaxLine {
    transactionId: number;
    agencyId: number;
    kind: TaxKind;
    rate: number;
    amount: number;
}
export declare function kindOf(offsetAccount: string): TaxKind | null;
export declare const fits: (agency: Agency, kind: TaxKind) => boolean;
export declare function candidates(rows: TaxableRow[], agencies: Agency[]): TaxCandidate[];
export declare const taxAmount: (amount: number, rate: number) => number;
export declare function taxLines(rows: TaxCandidate[], verdicts: Array<{
    id: number;
    agencyIds: number[];
}>, agencies: Agency[]): TaxLine[];
export interface SplitEntry {
    amount: number;
    offsetAccount: string;
    debitAccount: string;
    creditAccount: string;
}
export declare function taxSplit<E extends SplitEntry>(parent: E, lines: Array<{
    agency: string;
    amount: number;
}>): {
    parent: E;
    taxes: SplitEntry[];
};
