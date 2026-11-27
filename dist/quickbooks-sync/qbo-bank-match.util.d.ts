export interface OurBankAccount {
    accountName: string;
    mask: string | null;
    institution: string | null;
    kind: 'BANK' | 'CREDIT_CARD';
}
export interface QboBankAccount {
    id: string;
    name: string;
    acctNum: string | null;
    type: string;
}
export interface DatedCents {
    date: string;
    cents: number;
}
export declare function lastDigits(ours: OurBankAccount): string | null;
export declare function sameKind(ours: OurBankAccount, theirs: QboBankAccount): boolean;
export declare function nameScore(ours: OurBankAccount, theirs: QboBankAccount): number;
export declare function verifyMatch(ours: readonly DatedCents[], theirs: readonly DatedCents[]): {
    matched: number;
    compared: number;
};
export declare function acceptMatch(score: number, v: {
    matched: number;
    compared: number;
}, theirCount: number): boolean;
export declare function candidatesFor(ours: OurBankAccount, theirs: readonly QboBankAccount[], max?: number): Array<{
    account: QboBankAccount;
    score: number;
}>;
