import { IsIn, IsString, Length, MaxLength } from 'class-validator';

/** step12f: a text / WhatsApp from a phone with no account (from the INTERNAL API). */
export class ProspectReplyDto {
  @IsIn(['SMS', 'WHATSAPP'])
  channel!: 'SMS' | 'WHATSAPP';

  /** Their phone, E.164. */
  @IsString()
  @Length(3, 32)
  phone!: string;

  @IsString()
  @MaxLength(4000)
  text!: string;
}
