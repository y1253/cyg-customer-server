import { type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerAccountsService } from './customer-accounts.service';
import type { NameFieldDto } from './dto/agency.dto';
import { NameMemoryService } from './name-memory.service';
import { type BookScope } from './scope';
import { TaxService, type NameField } from './tax.service';
export interface SubNameView {
    id: number;
    parent: string;
    name: string;
    category: string;
    rows: number;
    total: number;
    group: string | null;
    fields: NameField[];
    renamed: boolean;
    ownAgencies: boolean;
    agencyIds: number[];
    agencyAlone: boolean;
    fromRule: boolean;
}
export interface SubNameSettings {
    name?: string;
    group?: string | null;
    fields?: NameFieldDto[];
    agencyIds?: number[] | null;
    alone?: boolean;
}
export declare class SubNamesService implements OnApplicationBootstrap {
    private readonly prisma;
    private readonly names;
    private readonly accounts;
    private readonly tax;
    private readonly logger;
    constructor(prisma: PrismaService, names: NameMemoryService, accounts: CustomerAccountsService, tax: TaxService);
    onApplicationBootstrap(): void;
    backfillParents(): Promise<void>;
    private adoptParentPicks;
    ensure(scope: BookScope, parent: string, category: string): Promise<{
        id: number;
        name: string;
    }>;
    list(scope: BookScope): Promise<SubNameView[]>;
    private rowTotals;
    setCategory(scope: BookScope, id: number, rawCategory: string): Promise<void>;
    setSettings(scope: BookScope, id: number, input: SubNameSettings): Promise<void>;
    private refuseTaken;
    remove(scope: BookScope, id: number): Promise<void>;
    merge(scope: BookScope, input: {
        from?: string;
        fromSubNameId?: number;
        into?: string;
        intoSubNameId?: number;
    }): Promise<void>;
    setParent(scope: BookScope, id: number, rawParent: string): Promise<void>;
    private get;
    private parentName;
    private moveRows;
}
