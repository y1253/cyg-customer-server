import { Transform } from 'class-transformer';
import { IsEmail, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** step12c: an account opened by phone adds an email — a code goes to that address first. */
export class EmailCodeDto {
  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(191)
  email!: string;
}

export class EmailVerifyDto extends EmailCodeDto {
  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code!: string;
}
