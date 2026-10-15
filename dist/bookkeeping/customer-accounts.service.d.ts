import { PrismaService } from '../prisma/prisma.service';
import { type AccountType } from './chart-of-accounts';
export declare const ACCOUNT_TYPES: readonly AccountType[];
export interface AccountView {
    name: string;
    type: AccountType;
    custom: boolean;
}
export declare class CustomerAccountsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    list(customerId: number): Promise<AccountView[]>;
    types(customerId: number): Promise<Map<string, AccountType>>;
    overrides(customerId: number): Promise<Map<string, AccountType>>;
    setType(customerId: number, account: string, type: AccountType): Promise<void>;
    resetType(customerId: number, account: string): Promise<void>;
    names(customerId: number): Promise<Set<string>>;
    validCategory(customerId: number, name: string): Promise<string>;
    create(customerId: number, input: {
        name: string;
        type: AccountType;
    }): Promise<AccountView>;
    private own;
}
