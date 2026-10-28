import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

/**
 * step12h: a text from a phone with no account, offered to its live call first (from the
 * INTERNAL API) — or, with `system`, a note from our side ("their account is open").
 */
export class ProspectLiveDto {
  /** Their phone, E.164. */
  @IsString()
  @Length(3, 32)
  phone!: string;

  @IsString()
  @MaxLength(4000)
  text!: string;

  @IsOptional()
  @IsBoolean()
  system?: boolean;
}
