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

/** The public cygfinance.com contact form. Limits mirror the form's own `maxLength`s. */
export class CreateContactDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  @MaxLength(256)
  firstName!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Last name is required' })
  @MaxLength(256)
  lastName!: string;

  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(256)
  email!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Phone is required' })
  @MaxLength(256)
  phone!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Company is required' })
  @MaxLength(256)
  company!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(256)
  title!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  message?: string;

  /**
   * Honeypot. Rendered off-screen by the client, so a person never fills it in; a bot
   * filling every field does. Accepted (not rejected) so the bot learns nothing.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  website?: string;
}
