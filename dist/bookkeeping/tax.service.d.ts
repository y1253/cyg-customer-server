import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type TypeContext } from './chart-of-accounts';
import { CustomerAccountsService } from './customer-accounts.service';
import { type RuleMatchType } from './name-memory.util';
import { type BookScope } from './scope';
import { SplitRulesService } from './split-rules.service';
import { type CreateAgencyDto, type NameFieldDto, type NameFieldKind, type SplitGroupDto, type UpdateSplitGroupDto, type UpdateAgencyDto } from './dto/agency.dto';
import { type TaxKind } from './tax.util';
export interface AgencyView {
    id: number;
    name: string;
    rates: Array<{
        kind: TaxKind;
        mode: 'PERCENT' | 'FIXED';
        rate: number;
        amount: number | null;
    }>;
    category: string | null;
    active: boolean;
    groupId: number | null;
}
export interface SplitGroupView {
    id: number;
    name: string;
    active: boolean;
    agencyIds: number[];
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
    fields: NameField[];
}
export interface NameField {
    kind: NameFieldKind;
    label: string;
    value: string;
}
export declare function parseNameFields(raw: unknown): NameField[];
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
        subName?: string;
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
    subDescriptions: Record<number, NameDescriptionView[]>;
    subContains: Record<number, NameView['followsContains']>;
}
export interface NameGroupView {
    key: string;
    label: string;
    id?: number;
}
export declare const BUILTIN_GROUPS: NameGroupView[];
export interface TaxSettingsView {
    agencies: AgencyView[];
    groups: SplitGroupView[];
}
export declare class TaxService {
    private readonly prisma;
    private readonly accounts;
    private readonly splitRules;
    constructor(prisma: PrismaService, accounts: CustomerAccountsService, splitRules: SplitRulesService);
    settings(scope: BookScope): Promise<TaxSettingsView>;
    createAgency(scope: BookScope, dto: CreateAgencyDto): Promise<AgencyView>;
    updateAgency(scope: BookScope, id: number, dto: UpdateAgencyDto): Promise<AgencyView>;
    private ruleCategory;
    removeAgency(scope: BookScope, id: number): Promise<void>;
    createGroup(scope: BookScope, dto: SplitGroupDto): Promise<SplitGroupView>;
    updateGroup(scope: BookScope, id: number, dto: UpdateSplitGroupDto): Promise<SplitGroupView>;
    removeGroup(scope: BookScope, id: number): Promise<void>;
    private ownedGroup;
    private checkGroupId;
    private checkGroupName;
    private joinGroupPicks;
    private ownedAgency;
    private checkName;
    agencyNames(scope: BookScope): Promise<string[]>;
    typeContext(scope: BookScope): Promise<TypeContext>;
    names(scope: BookScope): Promise<NamesView>;
    private namesOfFiles;
    addName(scope: BookScope, rawName: string, group: string | null): Promise<string>;
    checkGroup(scope: BookScope, group: string | null): Promise<void>;
    setNameGroup(scope: BookScope, rawName: string, group: string | null): Promise<void>;
    setNameFields(scope: BookScope, rawName: string, input: NameFieldDto[]): Promise<void>;
    mergeNameFields(scope: BookScope, source: string, target: string): Promise<void>;
    createNameGroup(scope: BookScope, rawName: string): Promise<NameGroupView>;
    renameNameGroup(scope: BookScope, id: number, rawName: string): Promise<void>;
    deleteNameGroup(scope: BookScope, id: number): Promise<void>;
    searchDescriptions(scope: BookScope, q: string): Promise<Array<{
        name: string;
        key: string;
        description: string;
    }>>;
    setNameAgencies(scope: BookScope, name: string, agencyIds: number[]): Promise<NamesView>;
    writePicks(scope: BookScope, clean: string, agencyIds: number[]): Promise<void>;
    moveSubNameKeys(scope: BookScope, oldName: string, newName: string): Promise<void>;
    dropSubNameKeys(scope: BookScope, name: string, parent: string | null): Promise<void>;
    carryAgencies(scope: BookScope, oldNames: readonly string[], newName: string): Promise<void>;
    carryNameSettings(scope: BookScope, oldNames: readonly string[], newName: string): Promise<void>;
    private copyNameRow;
    moveSubNames(scope: BookScope, oldNames: readonly string[], newName: string): Promise<void>;
    moveNameFiles(scope: BookScope, oldNames: readonly string[], newName: string): Promise<void>;
}
export declare function cleanNameFields(input: NameFieldDto[]): Prisma.InputJsonValue | typeof Prisma.DbNull;
