import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { NameMemoryService } from './name-memory.service';
import { type BookScope } from './scope';
export interface SubNameView {
    id: number;
    parent: string;
    name: string;
    category: string;
    rows: number;
}
export declare class SubNamesService {
    private readonly prisma;
    private readonly names;
    private readonly accounts;
    constructor(prisma: PrismaService, names: NameMemoryService, accounts: CustomerAccountsService);
    ensure(scope: BookScope, parent: string, category: string): Promise<{
        id: number;
        name: string;
    }>;
    list(scope: BookScope): Promise<SubNameView[]>;
    setCategory(scope: BookScope, id: number, rawCategory: string): Promise<void>;
    remove(scope: BookScope, id: number): Promise<void>;
    private ledgerNameId;
    private get;
    private parentName;
    private moveRows;
}
