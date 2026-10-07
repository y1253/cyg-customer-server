import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * What a customer may change about themselves: name and phone. Deliberately its own DTO —
 * email and authType are identity and are not editable here.
 */
export class UpdateMeDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(191)
  name?: string;

  /** `null` or `''` clears it. */
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  @Matches(/^[0-9+()\-.\s]{7,32}$/, { message: 'Enter a valid phone number' })
  phone?: string | null;
}
