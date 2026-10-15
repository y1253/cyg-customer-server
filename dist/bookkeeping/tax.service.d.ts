import { PrismaService } from '../prisma/prisma.service';
import { type TypeContext } from './chart-of-accounts';
import { CustomerAccountsService } from './customer-accounts.service';
import { type RuleMatchType } from './name-memory.util';
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
    settings(customerId: number): Promise<TaxSettingsView>;
    createAgency(customerId: number, dto: CreateAgencyDto): Promise<AgencyView>;
    updateAgency(customerId: number, id: number, dto: UpdateAgencyDto): Promise<AgencyView>;
    removeAgency(customerId: number, id: number): Promise<void>;
    private ownedAgency;
    private checkName;
    agencyNames(customerId: number): Promise<string[]>;
    typeContext(customerId: number): Promise<TypeContext>;
    linesFor(customerId: number, statementIds?: number[]): Promise<Map<number, StoredTax[]>>;
    private compute;
    names(customerId: number): Promise<NamesView>;
    setNameAgencies(customerId: number, name: string, agencyIds: number[]): Promise<NamesView>;
    carryAgencies(customerId: number, oldNames: readonly string[], newName: string): Promise<void>;
    renameLine(customerId: number, transactionId: number, agencyId: number, name: string | null): Promise<boolean>;
}
