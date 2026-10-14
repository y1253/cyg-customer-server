import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

export class ResendSignupDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(191)
  email!: string;
}
