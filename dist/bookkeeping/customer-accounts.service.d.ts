import { PrismaService } from '../prisma/prisma.service';
import { type BookScope } from './scope';
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
    list(scope: BookScope): Promise<AccountView[]>;
    types(scope: BookScope): Promise<Map<string, AccountType>>;
    overrides(scope: BookScope): Promise<Map<string, AccountType>>;
    setType(scope: BookScope, account: string, type: AccountType): Promise<void>;
    resetType(scope: BookScope, account: string): Promise<void>;
    setCurrency(scope: BookScope, account: string, currency: string): Promise<void>;
    resetCurrency(scope: BookScope, account: string): Promise<void>;
    names(scope: BookScope): Promise<Set<string>>;
    validCategory(scope: BookScope, name: string): Promise<string>;
    create(scope: BookScope, input: {
        name: string;
        type: AccountType;
    }): Promise<AccountView>;
    private own;
}
