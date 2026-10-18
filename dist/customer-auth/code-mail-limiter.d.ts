export declare const CODE_MAIL_GAP_MS = 60000;
export declare const CODE_MAIL_PER_ADDRESS = 5;
export declare const CODE_MAIL_DAY_MS: number;
export declare const CODE_MAIL_PER_HOUR_DEFAULT = 30;
export type CodeMailVerdict = 'ok' | 'address' | 'global';
export declare class CodeMailLimiter {
    private readonly perHour;
    private readonly now;
    private readonly byAddress;
    private global;
    constructor(perHour?: number, now?: () => number);
    check(email: string): CodeMailVerdict;
    record(email: string): void;
    private recent;
}
export declare function maskEmail(email: string): string;
