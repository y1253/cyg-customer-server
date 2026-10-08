import { ConfigService } from '@nestjs/config';
import { type TaxAgency } from '@prisma/client';
import { OpenAiClient } from '../ai/openai.client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateAgencyDto, UpdateAgencyDto } from './dto/agency.dto';
import { type TaxKind } from './tax.util';
export interface AgencyView {
    id: number;
    name: string;
    type: TaxAgency['type'];
    rate: number;
    active: boolean;
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
    private readonly logger;
    constructor(prisma: PrismaService, openai: OpenAiClient, config: ConfigService);
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
    agencyNames(customerId: number): Promise<string[]>;
    needsRetag(customerId: number): Promise<boolean>;
    retagCustomer(customerId: number): Promise<boolean>;
    tagStatement(customerId: number, statementId: number): Promise<void>;
    private tag;
    private ask;
}
