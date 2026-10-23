import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const blankToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

/** step12c: a contact on the Contacts tab. */
export class CreateContactDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'A contact needs a name' })
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(191)
  email?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class UpdateContactDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'A contact needs a name' })
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(191)
  email?: string | null;

  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
