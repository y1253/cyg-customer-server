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
