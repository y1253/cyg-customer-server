export interface OpeningStatement {
    id: number;
    accountName: string | null;
    openingBalance: number | null;
    closingBalance: number | null;
    periodStart: Date | null;
}
export interface OpeningRow {
    statementId: number;
    bankAccount: string;
    amount: number;
    postingDate: Date | null;
    description: string;
    offsetAccount: string;
    debitAccount: string;
    creditAccount: string;
}
export declare const STARTING_BALANCE = "Starting balance";
export declare function openingRows(statements: OpeningStatement[]): OpeningRow[];
export declare const num: (d: {
    toString(): string;
} | null) => number | null;
export declare const OPENING_STATEMENT_SELECT: {
    readonly id: true;
    readonly accountName: true;
    readonly bankName: true;
    readonly filename: true;
    readonly openingBalance: true;
    readonly closingBalance: true;
    readonly periodStart: true;
    readonly periodEnd: true;
};
export declare const OPENING_POSITION = -1;
export declare function ledgerOrder(a: {
    postingDate: Date | null;
    statementId: number;
    position: number;
}, b: {
    postingDate: Date | null;
    statementId: number;
    position: number;
}): number;
