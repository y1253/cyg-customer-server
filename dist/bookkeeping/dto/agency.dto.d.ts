import { SplitRateMode, TaxKind } from '@prisma/client';
export declare class AgencyRateDto {
    kind: TaxKind;
    mode?: SplitRateMode;
    rate?: number;
    amount?: number;
}
export declare class CreateAgencyDto {
    name: string;
    rates: AgencyRateDto[];
    category?: string | null;
    active?: boolean;
}
export declare class UpdateAgencyDto {
    name?: string;
    rates?: AgencyRateDto[];
    category?: string | null;
    active?: boolean;
}
export declare class SetNameAgenciesDto {
    name: string;
    agencyIds: number[];
}
export declare class SaveNameRuleDto {
    matchType: 'NAME' | 'DESCRIPTION' | 'CONTAINS';
    matchKey: string;
    name?: string | null;
    category?: string | null;
    scope?: 'ALWAYS' | 'ONCE';
    replace?: boolean;
    subNameId?: number | null;
}
export declare class ResetNameRuleDto {
    matchType: 'NAME' | 'DESCRIPTION' | 'CONTAINS';
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
    replace?: boolean;
}
export declare class CreateAccountDto {
    name: string;
    type: 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'EQUITY';
}
export declare class SetCurrencyDto {
    home: string;
}
export declare class SetAccountTypeDto {
    account: string;
    type: 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'EQUITY';
}
export declare class SetAccountCurrencyDto {
    account: string;
    currency: string;
}
export declare class ResetAccountTypeDto {
    account: string;
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
export declare class EditSplitDto {
    amount?: number;
    name?: string;
    nameScope?: 'ALWAYS' | 'ONCE';
    replace?: boolean;
    category?: string;
    categoryScope?: 'ALL' | 'SUB';
    itemName?: string;
    always?: boolean;
}
export declare class SetProductDto {
    itemName: string;
}
export declare class SetSubNameCategoryDto {
    category: string;
}
export declare class SetAttachmentTransactionDto {
    transactionId: number | null;
}
export declare class MoveStatementDto {
    accountName: string;
}
export declare class MergeDto {
    from: string;
    into: string;
}
export declare class MergeAccountsDto extends MergeDto {
    name?: string;
}
export declare class RenameAccountDto {
    from: string;
    to: string;
}
export declare class SetNameGroupDto {
    name: string;
    group: string | null;
}
export declare class NameGroupDto {
    name: string;
}
export declare const NAME_FIELD_KINDS: readonly ["PHONE", "EMAIL", "ADDRESS", "WEBSITE", "NOTE", "TEXT"];
export type NameFieldKind = (typeof NAME_FIELD_KINDS)[number];
export declare class NameFieldDto {
    kind: NameFieldKind;
    label: string;
    value: string;
}
export declare class SetNameFieldsDto {
    name: string;
    fields: NameFieldDto[];
}
export declare class SubNameSettingsDto {
    name?: string;
    group?: string | null;
    fields?: NameFieldDto[];
    agencyIds?: number[] | null;
}
