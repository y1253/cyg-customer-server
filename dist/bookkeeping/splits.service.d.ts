import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { ProductMemoryService } from './product-memory.service';
import { TaxService } from './tax.service';
export interface SplitInput {
    id?: number;
    name?: string | null;
    itemName?: string | null;
    category: string;
    amount: number;
    always?: boolean;
}
export declare class SplitsService {
    private readonly prisma;
    private readonly accounts;
    private readonly tax;
    private readonly products;
    constructor(prisma: PrismaService, accounts: CustomerAccountsService, tax: TaxService, products: ProductMemoryService);
    save(customerId: number, id: number, input: SplitInput[]): Promise<void>;
}
