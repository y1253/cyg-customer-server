export interface ExtractedTransaction {
    pendingDate: string | null;
    postingDate: string | null;
    description: string;
    amount: number;
    offsetAccount: string;
}
export interface LedgerRow {
    position: number;
    pendingDate: Date | null;
    postingDate: Date | null;
    description: string;
    amount: string;
    offsetAccount: string;
    debitAccount: string;
    creditAccount: string;
}
export declare function doubleEntry(amount: number, bankAccount: string, offsetAccount: string): {
    debitAccount: string;
    creditAccount: string;
};
export declare function parseIsoDate(raw: string | null | undefined): Date | null;
export declare function toMoney(raw: unknown): string | null;
export declare function buildLedgerRows(lines: ExtractedTransaction[], bankAccount: string): LedgerRow[];
