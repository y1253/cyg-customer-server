import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * An account WITH a password sends `currentPassword`; one without (created through Google)
 * sends the `code` emailed by `POST me/password/code` instead.
 */
export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from the email' })
  code?: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128)
  newPassword!: string;
}
