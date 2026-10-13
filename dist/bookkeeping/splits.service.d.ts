import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
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
    constructor(prisma: PrismaService, accounts: CustomerAccountsService, tax: TaxService);
    save(customerId: number, id: number, input: SplitInput[]): Promise<void>;
    itemRules(customerId: number): Promise<Map<string, string>>;
}
