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
    total: number;
    agencyIds: number[];
    descriptions: NameDescriptionView[];
    followsContains: Array<{
        key: string;
        text: string;
        category: string | null;
        rows: number;
    }>;
    exceptionOf: Array<{
        main: string;
        key: string;
        description: string;
        rows: number;
    }>;
    group: string;
    ruleKey: string;
    rule: {
        matchType: RuleMatchType;
        matchKey: string;
    } | null;
    unclarified?: true;
}
export interface NameDescriptionView {
    key: string;
    description: string;
    category: string;
    rows: number;
    rule: {
        id: number;
        matchType: 'DESCRIPTION' | 'CONTAINS';
        matchKey: string;
        text: string;
    } | null;
    exceptions: Array<{
        name: string;
        rows: number;
    }>;
}
export interface UnrecognizedView {
    key: string;
    sampleDescription: string;
    category: string;
    otherCategories: number;
    rows: number;
    total: number;
    rule: {
        matchType: RuleMatchType;
        matchKey: string;
    } | null;
}
export interface ContainsRuleView {
    text: string;
    key: string;
    name: string | null;
    category: string | null;
    rows: number;
}
export interface NamesView {
    names: NameView[];
    unrecognized: UnrecognizedView[];
    containsRules: ContainsRuleView[];
    groups: NameGroupView[];
}
export interface NameGroupView {
    key: string;
    label: string;
    id?: number;
}
export declare const BUILTIN_GROUPS: NameGroupView[];
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
    setNameGroup(scope: BookScope, rawName: string, group: string | null): Promise<void>;
    createNameGroup(scope: BookScope, rawName: string): Promise<NameGroupView>;
    renameNameGroup(scope: BookScope, id: number, rawName: string): Promise<void>;
    deleteNameGroup(scope: BookScope, id: number): Promise<void>;
    searchDescriptions(scope: BookScope, q: string): Promise<Array<{
        name: string;
        key: string;
        description: string;
    }>>;
    setNameAgencies(scope: BookScope, name: string, agencyIds: number[]): Promise<NamesView>;
    carryAgencies(scope: BookScope, oldNames: readonly string[], newName: string): Promise<void>;
    carryNameSettings(scope: BookScope, oldNames: readonly string[], newName: string): Promise<void>;
    renameLine(scope: BookScope, transactionId: number, agencyId: number, name: string | null): Promise<boolean>;
}
