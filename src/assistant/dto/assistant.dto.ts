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

  @IsString()
  @Length(1, 4000)
  text!: string;
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
}

export class IntakeAgentDto extends IntakeRouteDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string | null;

  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  attachmentIds!: number[];

  /** False = the reply cannot be sent (the phone opted out of texts). Default true. */
  @IsOptional()
  @IsBoolean()
  deliverable?: boolean;
}
