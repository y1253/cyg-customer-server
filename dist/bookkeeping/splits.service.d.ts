import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { NameMemoryService, type EditScope } from './name-memory.service';
import { ProductMemoryService } from './product-memory.service';
import { type BookScope } from './scope';
import { SubNamesService } from './sub-names.service';
import { TaxService } from './tax.service';
export interface SplitInput {
    id?: number;
    name?: string | null;
    itemName?: string | null;
    category: string;
    amount: number;
    always?: boolean;
}
export interface SplitEdit {
    amount?: number;
    name?: string;
    nameScope?: EditScope;
    replace?: boolean;
    category?: string;
    categoryScope?: 'ALL' | 'SUB';
    itemName?: string;
    always?: boolean;
}
export declare class SplitsService {
    private readonly prisma;
    private readonly accounts;
    private readonly tax;
    private readonly products;
    private readonly names;
    private readonly subNames;
    constructor(prisma: PrismaService, accounts: CustomerAccountsService, tax: TaxService, products: ProductMemoryService, names: NameMemoryService, subNames: SubNamesService);
    save(scope: BookScope, id: number, input: SplitInput[]): Promise<void>;
    duplicate(scope: BookScope, id: number): Promise<{
        id: number;
    }>;
    edit(scope: BookScope, id: number, input: SplitEdit): Promise<void>;
    remove(scope: BookScope, id: number): Promise<void>;
    private afterChange;
    setProduct(scope: BookScope, id: number, itemName: string): Promise<void>;
    private findSplit;
    private setCategory;
}
