import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class ChatDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  conversationId?: number;

  /** May be empty when files are sent (step11b). */
  @IsString()
  @MaxLength(4000)
  text!: string;

  /** step11b: files just uploaded to this book that go with the message. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  attachmentIds?: number[];
}

export class AttachmentChatDto {
  @IsString()
  @Length(1, 4000)
  text!: string;
}

export class IntakeRouteDto {
  @IsIn(['SMS', 'WHATSAPP', 'EMAIL'])
  channel!: 'SMS' | 'WHATSAPP' | 'EMAIL';

  /** The sender's phone (E.164), or their email address for EMAIL. */
  @IsString()
  @Length(3, 191)
  peer!: string;

  /** step11b: the words that came with the files — "switch to ABC" is applied first. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string | null;
}

export class IntakeAgentDto extends IntakeRouteDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  attachmentIds!: number[];

  /** False = the reply cannot be sent (the phone opted out of texts). Default true. */
  @IsOptional()
  @IsBoolean()
  deliverable?: boolean;

  /**
   * step11b: the receipt number written to — SMS: its E.164, WhatsApp: its phone_number_id.
   * With it this server sends the reply itself (plain message) and answers `sent: true`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  replyFrom?: string | null;
}

/** step12c: a text / call from a number that is no customer — maybe someone the AI reached. */
export class ContactReplyDto {
  @IsIn(['SMS', 'WHATSAPP', 'CALL'])
  channel!: 'SMS' | 'WHATSAPP' | 'CALL';

  /** Their phone, E.164. */
  @IsString()
  @Length(3, 32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string | null;
}
