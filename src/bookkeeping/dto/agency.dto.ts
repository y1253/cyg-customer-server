import { SplitRateMode, TaxKind } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * One rate of a split rule (step9 part 4: was a tax agency's). `kind` SALES = In (money
 * received), PURCHASE = Out (money spent). PERCENT: `rate` is a percent (10 = 10%), included
 * in the amount; FIXED: `amount` is split out of each row.
 */
export class AgencyRateDto {
  @IsEnum(TaxKind)
  kind!: TaxKind;

  @IsOptional()
  @IsEnum(SplitRateMode)
  mode?: SplitRateMode;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Rate must be a number' })
  @Min(0)
  @Max(100)
  rate?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Amount must be a number' })
  @Min(0.01, { message: 'A fixed amount must be more than 0' })
  @Max(999999999)
  amount?: number;
}

/** `POST /api/bookkeeping/agencies` — a split rule with an In and/or an Out rate. */
export class CreateAgencyDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the split rule a name' })
  @MaxLength(191)
  name!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Give the split rule an In or an Out rate' })
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => AgencyRateDto)
  rates!: AgencyRateDto[];

  /** Where its splits post; null / absent = the rule's own name. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(191)
  category?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** step9 (2026-11-17): its split group; null = an individual rule (on PATCH: absent = unchanged). */
  @IsOptional()
  @IsInt()
  groupId?: number | null;
}

/** `PATCH /api/bookkeeping/agencies/:id` — any subset; `rates` replaces them all. */
export class UpdateAgencyDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the split rule a name' })
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Give the split rule an In or an Out rate' })
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => AgencyRateDto)
  rates?: AgencyRateDto[];

  /** '' / null = the rule's own name. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(191)
  category?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** step9 (2026-11-17): its split group; null = an individual rule (on PATCH: absent = unchanged). */
  @IsOptional()
  @IsInt()
  groupId?: number | null;
}

/**
 * step9 (2026-11-17): `POST /api/bookkeeping/split-groups` / `PATCH …/:id` — a split group
 * (its rules run together on the same amount).
 */
export class SplitGroupDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the group a name' })
  @MaxLength(191)
  name!: string;

  /** step9 (2026-11-18): its rules' on / off switch (default on). */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** step9 (2026-11-18): `PATCH …/split-groups/:id` — rename it and / or switch it on or off. */
export class UpdateSplitGroupDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the group a name' })
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** `PATCH /api/bookkeeping/tax` — the sales-tax switch. */
/**
 * `PUT /api/bookkeeping/names/agencies` — the split rules of one payee name. A rule added
 * splits the name's existing rows once (and every new row); one removed leaves its splits.
 */
export class SetNameAgenciesDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  agencyIds!: number[];

  /** step9 (2026-11-19): one rule of a split group picked ON ITS OWN (not its group). */
  @IsOptional()
  @IsBoolean()
  alone?: boolean;
}

/** `PUT /api/bookkeeping/names/rule` — a customer's own name and/or category. */
export class SaveNameRuleDto {
  @IsIn(['NAME', 'DESCRIPTION', 'CONTAINS'])
  matchType!: 'NAME' | 'DESCRIPTION' | 'CONTAINS';

  /**
   * The `ruleKey` (NAME) or the description `key` (DESCRIPTION) the Names tab gave; for
   * CONTAINS the text every matching description contains (at least 3 characters).
   */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  matchKey!: string;

  /** Null or absent = leave the name as it is. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(191)
  name?: string | null;

  /** Null or absent = leave the category as it is. The chart or one of their own accounts. */
  @IsOptional()
  @IsString()
  @MaxLength(191)
  category?: string | null;

  /**
   * For the NAME only (a category is always the name's own): ALWAYS (default) = every row
   * with this description, now and later; ONCE = only the rows in the ledger now. Ignored
   * for a payee (NAME), which is always.
   */
  @IsOptional()
  @IsIn(['ALWAYS', 'ONCE'])
  scope?: 'ALWAYS' | 'ONCE';

  /**
   * step2 (2026-11-08): true = the description (or text) is already linked to ANOTHER name
   * and the customer agreed to take it away from that name. Without it such a save is a
   * 409 `RULE_CONFLICT` listing the links it would move.
   */
  @IsOptional()
  @IsBoolean()
  replace?: boolean;

  /**
   * step9 (2026-11-17, second request): DESCRIPTION — the sub-name of `name` the rows go
   * under (a description dropped on a sub-name). A name with sub-names takes descriptions
   * only this way.
   */
  @IsOptional()
  @IsInt()
  subNameId?: number | null;
}

/** `DELETE /api/bookkeeping/names/rule` — back to the default. */
export class ResetNameRuleDto {
  @IsIn(['NAME', 'DESCRIPTION', 'CONTAINS'])
  matchType!: 'NAME' | 'DESCRIPTION' | 'CONTAINS';

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  matchKey!: string;
}

/** `PUT /api/bookkeeping/products/rule` — "always put this item in this category". */
export class SaveProductRuleDto {
  /** The `itemKey` the Products tab gave (or a printed item name). */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  itemKey!: string;

  /** The chart or one of their own accounts. */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  category!: string;
}

/** 2026-11-27: `POST …/products/merge` — item `from` becomes item `into` (both item keys). */
export class MergeProductsDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  from!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  into!: string;
}

/** `DELETE /api/bookkeeping/products/rule` — back to the memory / the transaction's category. */
export class ResetProductRuleDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  itemKey!: string;
}

/** `PATCH /api/bookkeeping/transactions/:id` — one ledger row's name and/or category. */
export class EditTransactionDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(191)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  category?: string | null;

  /**
   * For the NAME only: ONCE = only this row; ALWAYS = every row with this description, now
   * and on every later statement. A category always becomes the name's one category.
   */
  @IsIn(['ALWAYS', 'ONCE'])
  scope!: 'ALWAYS' | 'ONCE';

  /**
   * step2 (2026-11-08): true = the description (or text) is already linked to ANOTHER name
   * and the customer agreed to take it away from that name. Without it such a save is a
   * 409 `RULE_CONFLICT` listing the links it would move.
   */
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}

/** `POST /api/bookkeeping/accounts` — a category of the customer's own. */
export class CreateAccountDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;

  @IsIn(['INCOME', 'EXPENSE', 'ASSET', 'LIABILITY', 'EQUITY'])
  type!: 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'EQUITY';
}

/** `PUT /api/bookkeeping/currency` — the customer's home currency (ISO 4217). */
export class SetCurrencyDto {
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  home!: string;
}

/** Move an account to another section of the chart (`PUT accounts/type`). */
export class SetAccountTypeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  account!: string;

  @IsIn(['INCOME', 'EXPENSE', 'ASSET', 'LIABILITY', 'EQUITY'])
  type!: 'INCOME' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'EQUITY';
}

/** The currency of one statement account (`PUT accounts/currency`), ISO 4217. */
export class SetAccountCurrencyDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  account!: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;
}

/** Put a moved account back (`DELETE accounts/type`), or drop its currency setting. */
export class ResetAccountTypeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  account!: string;
}

/** One hand-made split of a transaction. `amount` is positive; it takes the parent's sign. */
export class SplitDto {
  /** An existing split to keep (and update); omitted for a new one. */
  @IsOptional()
  @IsNumber()
  id?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(191)
  name?: string | null;

  /** The receipt line this split is for ("Pampers"). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(191)
  itemName?: string | null;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  category!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  /** Remember the item's category for later receipts. */
  @IsOptional()
  @IsBoolean()
  always?: boolean;
}

/**
 * `PUT /api/bookkeeping/transactions/:id/splits` — the transaction's whole set of splits:
 * listed ones are kept or created, missing ones removed (an empty list un-splits it).
 */
export class SaveSplitsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SplitDto)
  splits!: SplitDto[];
}

/**
 * step2 (2026-11-15): `PATCH /api/bookkeeping/transactions/:id/split` — one split edited in
 * place in the ledger. Only the fields sent change.
 */
export class EditSplitDto {
  /** Positive, as typed (with its tax); 0 is allowed. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name?: string;

  /** ONCE (default) = this split only; ALWAYS = the description's rule moves to the name. */
  @IsOptional()
  @IsIn(['ALWAYS', 'ONCE'])
  nameScope?: 'ALWAYS' | 'ONCE';

  /** Take the description from the name it is linked to now (the conflict question). */
  @IsOptional()
  @IsBoolean()
  replace?: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  category?: string;

  /** ALL = the name's category (every row of it); SUB = only this split, as a sub-name. */
  @IsOptional()
  @IsIn(['ALL', 'SUB'])
  categoryScope?: 'ALL' | 'SUB';

  /** The Product column; '' clears it. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(191)
  itemName?: string;

  /** Remember the product's category for later receipts. */
  @IsOptional()
  @IsBoolean()
  always?: boolean;
}

/**
 * step12 (2026-11-22): `POST /api/bookkeeping/transactions/:id/split-rule` — a ONE-TIME split
 * by a split group or one rule (exactly one of the two): ONE = this transaction, NAME = every
 * existing row of its name. No pick is saved.
 */
export class ApplySplitRuleDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  agencyId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  groupId?: number;

  @IsIn(['ONE', 'NAME'])
  scope!: 'ONE' | 'NAME';
}

/** step2 (2026-11-15): `PATCH /api/bookkeeping/transactions/:id/product` — a row's Product. */
export class SetProductDto {
  @Transform(trim)
  @IsString()
  @MaxLength(191)
  itemName!: string;
}

/** step2 (2026-11-15): `PATCH /api/bookkeeping/sub-names/:id` — a sub-name's category. */
export class SetSubNameCategoryDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  category!: string;
}

/**
 * step9 (2026-11-23): `PATCH /api/bookkeeping/sub-names/:id/parent` — the name it moves
 * under (it stays a sub-name; only its parent changes).
 */
export class SetSubNameParentDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;
}

/** `PATCH /api/bookkeeping/attachments/:id` — attach to a transaction, or `null` to detach. */
export class SetAttachmentTransactionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  transactionId!: number | null;
}

/** `PATCH /api/bookkeeping/statements/:id/account` — file it under this account. */
export class MoveStatementDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter an account name' })
  @MaxLength(191)
  accountName!: string;
}

/** step8: merge one payee name, or one account, into another (drag one onto the other). */
export class MergeDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  from!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  into!: string;
}

/**
 * step9 (2026-11-17, third request): merge names AND sub-names — a sub-name works like a
 * name. Exactly one of `from` / `fromSubNameId`, and one of `into` / `intoSubNameId`.
 */
export class MergeNamesDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  from?: string;

  @IsOptional()
  @IsInt()
  fromSubNameId?: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  into?: string;

  @IsOptional()
  @IsInt()
  intoSubNameId?: number;
}

/**
 * step8: merge one account into another. step2 (2026-11-08): `name` = what the merged
 * account is called ("TD 4562 & 5845" for two bank folders); omitted = `into`'s name.
 */
export class MergeAccountsDto extends MergeDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(191)
  name?: string;
}

/** step2 (2026-11-08): rename an account (click its name on the reports / Bank feeds). */
export class RenameAccountDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  from!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  to!: string;
}

/** step9: put a payee name in a Names-tab group (null = back to following its category). */
export class SetNameGroupDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^(CUSTOMER|SUPPLIER|OTHER|g\d+)$/, { message: 'Pick a group' })
  group!: string | null;
}

/** step9: a customer's own Names-tab group ("Employees"). */
export class NameGroupDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string;
}

/** step2 (2026-11-09): one field of a name's profile (its phone, email, address, …). */
export const NAME_FIELD_KINDS = [
  'PHONE',
  'EMAIL',
  'ADDRESS',
  'WEBSITE',
  'NOTE',
  'TEXT',
] as const;
export type NameFieldKind = (typeof NAME_FIELD_KINDS)[number];

export class NameFieldDto {
  @IsIn(NAME_FIELD_KINDS)
  kind!: NameFieldKind;

  @Transform(trim)
  @IsString()
  @MaxLength(64)
  label!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(500)
  value!: string;
}

/** step2 (2026-11-09): a name's whole profile — [] clears it. */
export class SetNameFieldsDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => NameFieldDto)
  fields!: NameFieldDto[];
}

/**
 * step9 part 3 (2026-11-15): `PATCH /api/bookkeeping/sub-names/:id/settings` — a sub-name's
 * own name ('' = "<parent> - <category>" again), group (null = the parent's), profile and
 * agencies (null = follow the parent's, [] = untaxed). An absent field is unchanged.
 */
export class SubNameSettingsDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(CUSTOMER|SUPPLIER|OTHER|g\d+)$/, { message: 'Pick a group' })
  group?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => NameFieldDto)
  fields?: NameFieldDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  agencyIds?: number[] | null;

  /** step9 (2026-11-19): one rule of a split group picked on its own. */
  @IsOptional()
  @IsBoolean()
  alone?: boolean;
}
