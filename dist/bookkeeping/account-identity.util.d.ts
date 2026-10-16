export interface KnownAccount {
    name: string;
    kind: string | null;
}
export declare function bankTextOf(name: string): string;
export declare function digitsOf(name: string): string;
export declare function sameAccountDigits(a: string, b: string): boolean;
export declare function isSameAccount(a: {
    name: string;
    kind: string | null;
    digits?: string | null;
}, b: {
    name: string;
    kind: string | null;
    digits?: string | null;
}): boolean;
export declare function canonicalAccountName(read: {
    accountName: string | null;
    accountNumber?: string | null;
    accountKind: string | null;
}, existing: KnownAccount[]): string | null;
export declare function mergeGroups(accounts: (KnownAccount & {
    statements: number;
})[]): {
    keep: string;
    merge: string[];
}[];
