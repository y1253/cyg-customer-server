import { TaxAgencyType } from '@prisma/client';
export declare class CreateAgencyDto {
    name: string;
    type: TaxAgencyType;
    rate: number;
    active?: boolean;
}
export declare class UpdateAgencyDto {
    name?: string;
    type?: TaxAgencyType;
    rate?: number;
    active?: boolean;
}
export declare class UpdateTaxDto {
    enabled: boolean;
}
