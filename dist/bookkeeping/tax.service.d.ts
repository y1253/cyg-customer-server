import { PrismaService } from '../prisma/prisma.service';
import { type TypeContext } from './chart-of-accounts';
import { CustomerAccountsService } from './customer-accounts.service';
import { type RuleMatchType } from './name-memory.util';
import { type BookScope } from './scope';
import type { CreateAgencyDto, UpdateAgencyDto } from './dto/agency.dto';
import { type TaxKind } from './tax.util';
export interface AgencyView {
    id: number;
    name: string;
    rates: Array<{
        kind: TaxKind;
        rate: number;
    }>;
    active: boolean;
}
export type NameType = 'CUSTOMER' | 'SUPPLIER' | 'OTHER';
export interface NameView {
    name: string;
    category: string;
    otherCategories: number;
    type: NameType;
    rows: number;
    agencyIds: number[];
    descriptions: Array<{
        description: string;
        category: string;
        rows: number;
    }>;
    ruleKey: string;
    rule: {
        matchType: RuleMatchType;
        matchKey: string;
    } | null;
    unclarified?: true;
}
export interface UnrecognizedView {
    key: string;
    sampleDescription: string;
    category: string;
    otherCategories: number;
    rows: number;
    rule: {
        matchType: RuleMatchType;
        matchKey: string;
    } | null;
}
export interface NamesView {
    names: NameView[];
    unrecognized: UnrecognizedView[];
}
export interface StoredTax {
    agencyId: number;
    agency: string;
    name: string | null;
    kind: TaxKind;
    rate: number;
    amount: number;
}
export interface TaxSettingsView {
    agencies: AgencyView[];
}
export declare class TaxService {
    private readonly prisma;
    private readonly accounts;
    constructor(prisma: PrismaService, accounts: CustomerAccountsService);
    settings(scope: BookScope): Promise<TaxSettingsView>;
    createAgency(scope: BookScope, dto: CreateAgencyDto): Promise<AgencyView>;
    updateAgency(scope: BookScope, id: number, dto: UpdateAgencyDto): Promise<AgencyView>;
    removeAgency(scope: BookScope, id: number): Promise<void>;
    private ownedAgency;
    private checkName;
    agencyNames(scope: BookScope): Promise<string[]>;
    typeContext(scope: BookScope): Promise<TypeContext>;
    linesFor(scope: BookScope, statementIds?: number[]): Promise<Map<number, StoredTax[]>>;
    private compute;
    names(scope: BookScope): Promise<NamesView>;
    setNameAgencies(scope: BookScope, name: string, agencyIds: number[]): Promise<NamesView>;
    carryAgencies(scope: BookScope, oldNames: readonly string[], newName: string): Promise<void>;
    renameLine(scope: BookScope, transactionId: number, agencyId: number, name: string | null): Promise<boolean>;
}
