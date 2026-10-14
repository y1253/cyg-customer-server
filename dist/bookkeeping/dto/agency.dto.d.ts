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
    scope?: 'ALWAYS' | 'ONCE';
}
export declare class ResetNameRuleDto {
    matchType: 'NAME' | 'DESCRIPTION';
    matchKey: string;
}
export declare class SaveProductRuleDto {
    itemKey: string;
    category: string;
}
export declare class ResetProductRuleDto {
    itemKey: string;
}
export declare class EditTransactionDto {
    name?: string | null;
    category?: string | null;
    scope: 'ALWAYS' | 'ONCE';
}
export declare class CreateAccountDto {
    name: string;
    type: 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'EQUITY';
}
export declare class SplitDto {
    id?: number;
    name?: string | null;
    itemName?: string | null;
    category: string;
    amount: number;
    always?: boolean;
}
export declare class SaveSplitsDto {
    splits: SplitDto[];
}
export declare class RenameTaxLineDto {
    name?: string | null;
}
export declare class SetAttachmentTransactionDto {
    transactionId: number | null;
}
