export interface StatementPdfRow {
    postingDate: Date | null;
    pendingDate: Date | null;
    name: string | null;
    description: string;
    amount: number;
}
export interface StatementPdfInput {
    title: string;
    bankName: string | null;
    accountName: string | null;
    owner: string;
    periodStart: Date | null;
    periodEnd: Date | null;
    currency: string | null;
    creditCard: boolean;
    opening: number | null;
    closing: number | null;
    rows: readonly StatementPdfRow[];
}
export declare function runningBalances(opening: number | null, rows: readonly {
    amount: number;
}[], creditCard: boolean): Array<number | null>;
export declare function statementPdf(s: StatementPdfInput): Promise<Buffer>;
