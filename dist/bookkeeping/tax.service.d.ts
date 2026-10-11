import { ConfigService } from '@nestjs/config';
import { OpenAiClient } from '../ai/openai.client';
import { PrismaService } from '../prisma/prisma.service';
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
    taxExempt: boolean;
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
    id: number;
    agency: string;
    kind: TaxKind;
    rate: number;
    amount: number;
}
export interface TaxSettingsView {
    enabled: boolean;
    stale: boolean;
    running: boolean;
    agencies: AgencyView[];
}
export declare class TaxService {
    private readonly prisma;
    private readonly openai;
    private readonly config;
    private readonly accounts;
    private readonly logger;
    constructor(prisma: PrismaService, openai: OpenAiClient, config: ConfigService, accounts: CustomerAccountsService);
    private model;
    settings(customerId: number): Promise<TaxSettingsView>;
    setEnabled(customerId: number, enabled: boolean): Promise<TaxSettingsView>;
    createAgency(customerId: number, dto: CreateAgencyDto): Promise<AgencyView>;
    updateAgency(customerId: number, id: number, dto: UpdateAgencyDto): Promise<AgencyView>;
    removeAgency(customerId: number, id: number): Promise<void>;
    private markStale;
    private ownedAgency;
    private checkName;
    linesFor(customerId: number, statementIds?: number[]): Promise<Map<number, StoredTax[]>>;
    private exemptNames;
    names(customerId: number): Promise<NamesView>;
    setNameTax(customerId: number, name: string, taxExempt: boolean): Promise<NamesView>;
    agencyNames(customerId: number): Promise<string[]>;
    needsRetag(customerId: number): Promise<boolean>;
    retagCustomer(customerId: number): Promise<boolean>;
    tagStatement(customerId: number, statementId: number): Promise<void>;
    private tag;
    private ask;
}
