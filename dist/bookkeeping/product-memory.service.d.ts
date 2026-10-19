import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { ProductCategorizer } from './product-categorizer';
import { type ProductView } from './product-memory.util';
import { type BookScope } from './scope';
import { TaxService } from './tax.service';
export declare class ProductMemoryService {
    private readonly prisma;
    private readonly accounts;
    private readonly categorizer;
    private readonly tax;
    private readonly logger;
    constructor(prisma: PrismaService, accounts: CustomerAccountsService, categorizer: ProductCategorizer, tax: TaxService);
    categoriesFor(scope: BookScope, names: readonly string[], context: {
        store?: string | null;
        parentCategory: string;
    }): Promise<(itemName: string) => string>;
    itemRules(scope: BookScope): Promise<Map<string, string>>;
    products(scope: BookScope): Promise<ProductView[]>;
    saveRule(scope: BookScope, rawKey: string, rawCategory: string): Promise<void>;
    resetRule(scope: BookScope, rawKey: string): Promise<void>;
    private memoryFor;
    private learn;
    private itemRows;
    private writeRows;
}
