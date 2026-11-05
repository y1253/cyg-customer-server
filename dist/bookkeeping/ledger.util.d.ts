export interface ExtractedTransaction {
    pendingDate: string | null;
    postingDate: string | null;
    description: string;
    name?: string | null;
    amount: number;
    balanceAfter: number | null;
    offsetAccount: string;
    page?: number;
    provenance?: Provenance;
}
export interface Provenance {
    generalRuleId: number | null;
    personalRuleId: number | null;
    exceptionRuleId: number | null;
    ruleName: string | null;
}
export interface LedgerRow {
    position: number;
    pendingDate: Date | null;
    postingDate: Date | null;
    description: string;
    name: string | null;
    amount: string;
    balanceAfter: string | null;
    offsetAccount: string;
    debitAccount: string;
    creditAccount: string;
    generalRuleId?: number | null;
    personalRuleId?: number | null;
    exceptionRuleId?: number | null;
    ruleName?: string | null;
    manualEdit?: boolean;
}
export declare function doubleEntry(amount: number, bankAccount: string, offsetAccount: string): {
    debitAccount: string;
    creditAccount: string;
};
export declare function parseIsoDate(raw: string | null | undefined): Date | null;
export declare function toMoney(raw: unknown): string | null;
export declare function buildLedgerRows(lines: ExtractedTransaction[], bankAccount: string, customAccounts?: Iterable<string>): LedgerRow[];
