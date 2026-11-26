import type { AccountType } from '../bookkeeping/chart-of-accounts';
export interface QboLine {
    category: string;
    cents: number;
    description: string | null;
}
export interface QboFamily {
    rowId: number;
    externalId: string;
    date: string;
    cents: number;
    name: string | null;
    description: string;
    kind: 'BANK' | 'CREDIT_CARD';
    plaidAccountId: number;
    lines: QboLine[];
}
export type QboTxnType = 'Purchase' | 'Deposit';
export declare const UNCATEGORIZED_EXPENSE = "Uncategorized Expense";
export declare const UNCATEGORIZED_INCOME = "Uncategorized Income";
export declare function familyLines(parent: {
    amount: number;
    category: string;
    description: string | null;
}, splits: ReadonlyArray<{
    amount: number;
    category: string;
    description: string | null;
}>): QboLine[];
export declare function qboTypeOf(family: Pick<QboFamily, 'cents' | 'kind'>): QboTxnType;
export declare function qboCategoryName(category: string, moneyOut: boolean): string;
export declare function qboAccountType(name: string, type: AccountType): {
    AccountType: string;
};
export declare function qboText(value: string, max?: number): string;
export declare const MIX_SUFFIX = "-mix";
export declare function qboPayeeName(name: string, mixed: boolean): string;
export interface QboPayeeRef {
    id: string;
    type: string;
}
export declare function repointEntity(type: QboTxnType, txn: Record<string, unknown>, fromId: string, to: QboPayeeRef): Record<string, unknown> | null;
export declare function qboQuote(value: string): string;
export declare function familyHash(family: QboFamily): string;
export interface QboRefs {
    bankAccountId: string;
    entity: {
        id: string;
        type: 'Vendor' | 'Customer' | 'Employee';
    } | null;
    accountIds: ReadonlyMap<string, string>;
}
export declare function qboBody(family: QboFamily, refs: QboRefs): Record<string, unknown>;
