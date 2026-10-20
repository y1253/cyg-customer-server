import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** How a customer prefers to be contacted (step12). */
export const CONTACT_METHODS = ['EMAIL', 'WHATSAPP', 'SMS'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

/**
 * What a customer may change about themselves: name, phone and preferred contact method.
 * Deliberately its own DTO —
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

  /** `null` clears it. WHATSAPP / SMS need a phone (checked in the service). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(CONTACT_METHODS, { message: 'Pick email, WhatsApp or text message' })
  preferredContact?: ContactMethod | null;
}
