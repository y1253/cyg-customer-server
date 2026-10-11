import { TaxKind } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** One rate of an agency; `rate` is a percent (10 = 10%). */
export class AgencyRateDto {
  @IsEnum(TaxKind)
  kind!: TaxKind;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Rate must be a number' })
  @Min(0)
  @Max(100)
  rate!: number;
}

/** `POST /api/bookkeeping/agencies` — a tax agency with a Sales and/or Purchase rate. */
export class CreateAgencyDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the agency a name' })
  @MaxLength(191)
  name!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Give the agency a Sales or a Purchase rate' })
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => AgencyRateDto)
  rates!: AgencyRateDto[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** `PATCH /api/bookkeeping/agencies/:id` — any subset; `rates` replaces them all. */
export class UpdateAgencyDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the agency a name' })
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Give the agency a Sales or a Purchase rate' })
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => AgencyRateDto)
  rates?: AgencyRateDto[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** `PATCH /api/bookkeeping/tax` — the sales-tax switch. */
export class UpdateTaxDto {
  @IsBoolean()
  enabled!: boolean;
}

/** `PATCH /api/bookkeeping/names` — switch tax on/off for one AI-read payee name. */
export class UpdateNameDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  name!: string;

  @IsBoolean()
  taxExempt!: boolean;
}

/** `PUT /api/bookkeeping/names/rule` — a customer's own name and/or category. */
export class SaveNameRuleDto {
  @IsIn(['NAME', 'DESCRIPTION'])
  matchType!: 'NAME' | 'DESCRIPTION';

  /** The `ruleKey` (NAME) or the description `key` (DESCRIPTION) the Names tab gave. */
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

  /** ALWAYS (default) = saved for the future; ONCE = only the rows in the ledger now. */
  @IsOptional()
  @IsIn(['ALWAYS', 'ONCE'])
  scope?: 'ALWAYS' | 'ONCE';
}

/** `DELETE /api/bookkeeping/names/rule` — back to the default. */
export class ResetNameRuleDto {
  @IsIn(['NAME', 'DESCRIPTION'])
  matchType!: 'NAME' | 'DESCRIPTION';

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  matchKey!: string;
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

  /** ONCE = only this row; ALWAYS = saved for this payee from now on. */
  @IsIn(['ALWAYS', 'ONCE'])
  scope!: 'ALWAYS' | 'ONCE';
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
