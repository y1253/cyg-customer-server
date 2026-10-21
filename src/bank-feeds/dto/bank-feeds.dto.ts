import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ExchangeDto {
  /** Plaid Link's `public_token` (`public-<env>-<uuid>`). */
  @IsString()
  @MaxLength(200)
  @Matches(/^public-[a-z]+-[A-Za-z0-9-]+$/, {
    message: 'Invalid bank connection token',
  })
  publicToken!: string;
}

export class StartDateDto {
  @IsInt()
  @Min(1)
  id!: number;

  /** YYYY-MM-DD; null or absent = all the history Plaid gives. */
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'A start date is YYYY-MM-DD' })
  startDate?: string | null;
}

export class StartDatesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StartDateDto)
  accounts!: StartDateDto[];
}
