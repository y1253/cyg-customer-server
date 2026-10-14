import { Transform } from 'class-transformer';
import { IsEmail, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class VerifySignupDto {
  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(191)
  email!: string;

  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from the email' })
  code!: string;
}
