import { ConfigService } from '@nestjs/config';
export declare const QBO_SYSTEM_TOKEN_TYPE = "qbo-system";
export declare class QboCallError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
type Entity = 'Account' | 'Customer' | 'Deposit' | 'Employee' | 'Purchase' | 'Vendor';
export declare class QboSystemClient {
    private readonly config;
    private readonly jwt;
    constructor(config: ConfigService);
    query<T = Record<string, unknown>>(companyId: number, query: string): Promise<T>;
    create(companyId: number, entity: Entity, body: Record<string, unknown>): Promise<Record<string, {
        Id?: string;
    } | undefined>>;
    update(companyId: number, entity: Entity, id: string, body: Record<string, unknown>): Promise<Record<string, {
        Id?: string;
    } | undefined>>;
    remove(companyId: number, entity: 'Purchase' | 'Deposit', id: string): Promise<unknown>;
    private post;
}
export {};
