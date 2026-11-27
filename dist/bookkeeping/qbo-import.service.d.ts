import { PrismaService } from '../prisma/prisma.service';
import { CustomColumnsService } from './custom-columns.service';
import { CustomerAccountsService } from './customer-accounts.service';
import { NameMemoryService } from './name-memory.service';
import { type ImportAnalysis } from './qbo-import.util';
import { type BookScope } from './scope';
export interface ImportPlan {
    categories: Array<{
        name: string;
        type: string | null;
    }>;
    names: Array<{
        payee: string;
        aliases: string[];
        category: string | null;
        split: Array<{
            key: string;
            category: string;
        }> | null;
        splitCategories: string[];
    }>;
    descriptions: Array<{
        key: string;
        payee: string;
        category: string | null;
    }>;
    columns: Array<{
        kind: 'CLASS' | 'FIELD';
        ref: string | null;
        name: string;
        options: string[];
    }>;
    defaults: Array<{
        payee: string;
        category: string | null;
        kind: 'CLASS' | 'FIELD';
        ref: string | null;
        value: string;
    }>;
}
export interface ImportResult {
    rules: number;
    categoriesCreated: string[];
    subNames: number;
    errors: string[];
    columns: number;
    defaults: number;
}
export declare class QboImportService {
    private readonly prisma;
    private readonly accounts;
    private readonly names;
    private readonly columns;
    private readonly logger;
    constructor(prisma: PrismaService, accounts: CustomerAccountsService, names: NameMemoryService, columns: CustomColumnsService);
    analyze(scope: BookScope, input: {
        since?: unknown;
        txns?: unknown;
    }): Promise<ImportAnalysis>;
    private rowsSince;
    private rules;
    apply(scope: BookScope, raw: unknown): Promise<ImportResult>;
    private bookHasName;
    private subNamesOf;
    private categories;
}
export declare function cleanPlan(raw: unknown): ImportPlan;
