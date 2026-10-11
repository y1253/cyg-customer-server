import { TaxKind } from '@prisma/client';
export declare class AgencyRateDto {
    kind: TaxKind;
    rate: number;
}
export declare class CreateAgencyDto {
    name: string;
    rates: AgencyRateDto[];
    active?: boolean;
}
export declare class UpdateAgencyDto {
    name?: string;
    rates?: AgencyRateDto[];
    active?: boolean;
}
export declare class UpdateTaxDto {
    enabled: boolean;
}
export declare class UpdateNameDto {
    name: string;
    taxExempt: boolean;
}
export declare class SaveNameRuleDto {
    matchType: 'NAME' | 'DESCRIPTION';
    matchKey: string;
    name?: string | null;
    category?: string | null;
}
export declare class ResetNameRuleDto {
    matchType: 'NAME' | 'DESCRIPTION';
    matchKey: string;
}
