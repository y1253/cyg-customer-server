import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService, type AccountView } from './customer-accounts.service';
import { NameMemoryService } from './name-memory.service';
import { ProductMemoryService } from './product-memory.service';
import type { ProductView } from './product-memory.util';
import { type BookScope } from './scope';
export interface StaffNameRuleView {
    id: number;
    matchType: 'NAME' | 'DESCRIPTION' | 'CONTAINS';
    matchKey: string;
    example: string | null;
    name: string | null;
    category: string | null;
    effectiveCategory: string | null;
    rows: number;
    updatedAt: string;
}
export interface StaffItemRuleView {
    id: number;
    itemKey: string;
    category: string;
    name: string | null;
    updatedAt: string;
}
export interface StaffRulesView {
    descriptions: StaffNameRuleView[];
    names: StaffNameRuleView[];
    items: StaffItemRuleView[];
    products: ProductView[];
    categories: AccountView[];
}
export declare class StaffRulesService {
    private readonly prisma;
    private readonly accounts;
    private readonly nameMemory;
    private readonly productMemory;
    constructor(prisma: PrismaService, accounts: CustomerAccountsService, nameMemory: NameMemoryService, productMemory: ProductMemoryService);
    view(scope: BookScope): Promise<StaffRulesView>;
}
