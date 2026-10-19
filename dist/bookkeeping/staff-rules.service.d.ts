import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService, type AccountView } from './customer-accounts.service';
import { NameMemoryService } from './name-memory.service';
import { type BookScope } from './scope';
export interface StaffNameRuleView {
    id: number;
    matchType: 'NAME' | 'DESCRIPTION';
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
    updatedAt: string;
}
export interface StaffRulesView {
    descriptions: StaffNameRuleView[];
    names: StaffNameRuleView[];
    items: StaffItemRuleView[];
    categories: AccountView[];
}
export declare class StaffRulesService {
    private readonly prisma;
    private readonly accounts;
    private readonly nameMemory;
    constructor(prisma: PrismaService, accounts: CustomerAccountsService, nameMemory: NameMemoryService);
    view(scope: BookScope): Promise<StaffRulesView>;
}
