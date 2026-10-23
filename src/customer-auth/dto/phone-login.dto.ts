import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** step12c: "text me a code" on the login page's Phone tab. */
export class PhoneLoginDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter your phone number' })
  @MaxLength(32)
  phone!: string;

  /** Cloudflare Turnstile token; required only while `TURNSTILE_SECRET_KEY` is set. */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  turnstileToken?: string;
}

/** step12c: the texted code. */
export class PhoneLoginVerifyDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Enter your phone number' })
  @MaxLength(32)
  phone!: string;

  @Transform(trim)
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code!: string;
}

/** step12c: the internal API opening an account for a phone that replied YES to the offer. */
export class PhoneSignupDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;

  @IsIn(['SMS', 'WHATSAPP', 'CALL'])
  createdWith!: 'SMS' | 'WHATSAPP' | 'CALL';
}
