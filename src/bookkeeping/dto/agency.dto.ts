import { TaxAgencyType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** `POST /api/bookkeeping/agencies` — a tax agency; `rate` is a percent (10 = 10%). */
export class CreateAgencyDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the agency a name' })
  @MaxLength(191)
  name!: string;

  @IsEnum(TaxAgencyType)
  type!: TaxAgencyType;

  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Rate must be a number' })
  @Min(0)
  @Max(100)
  rate!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** `PATCH /api/bookkeeping/agencies/:id` — any subset. */
export class UpdateAgencyDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the agency a name' })
  @MaxLength(191)
  name?: string;

  @IsOptional()
  @IsEnum(TaxAgencyType)
  type?: TaxAgencyType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'Rate must be a number' })
  @Min(0)
  @Max(100)
  rate?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** `PATCH /api/bookkeeping/tax` — the sales-tax switch. */
export class UpdateTaxDto {
  @IsBoolean()
  enabled!: boolean;
}
