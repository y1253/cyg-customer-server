import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { ProductCategorizer } from './product-categorizer';
import { type ProductView } from './product-memory.util';
import { TaxService } from './tax.service';
export declare class ProductMemoryService {
    private readonly prisma;
    private readonly accounts;
    private readonly categorizer;
    private readonly tax;
    private readonly logger;
    constructor(prisma: PrismaService, accounts: CustomerAccountsService, categorizer: ProductCategorizer, tax: TaxService);
    categoriesFor(customerId: number, names: readonly string[], context: {
        store?: string | null;
        parentCategory: string;
    }): Promise<(itemName: string) => string>;
    itemRules(customerId: number): Promise<Map<string, string>>;
    products(customerId: number): Promise<ProductView[]>;
    saveRule(customerId: number, rawKey: string, rawCategory: string): Promise<void>;
    resetRule(customerId: number, rawKey: string): Promise<void>;
    private memoryFor;
    private learn;
    private itemRows;
    private writeRows;
}
