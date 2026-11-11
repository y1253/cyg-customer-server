import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** step8: one option of a DROPDOWN column; `id` keeps an existing one. */
export class CustomColumnOptionDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  id?: number;

  @IsString()
  @MaxLength(200)
  label!: string;
}

/**
 * step8 (2026-11-11): a ledger column of the customer's own. The rules (name, type, min /
 * max characters, options) are checked by `cleanColumn` (custom-column.util.ts), which says
 * exactly what is wrong — the DTO only checks shapes.
 */
export class CustomColumnDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  type!: string;

  @IsOptional()
  @IsInt()
  minChars?: number | null;

  @IsOptional()
  @IsInt()
  maxChars?: number | null;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CustomColumnOptionDto)
  options?: CustomColumnOptionDto[];
}

/** step8: copy the columns of another book of the same customer into this one. */
export class CopyCustomColumnsDto {
  @IsInt()
  @Min(1)
  fromBookId!: number;
}

/** step8: one cell — text for TEXT / LETTERS / NUMBER, an option for DROPDOWN; both empty = clear. */
export class CustomAnswerDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  value?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  dropDownId?: number | null;
}

/** step8: column order (ids, left to right). */
export class CustomColumnOrderDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  ids!: number[];
}
