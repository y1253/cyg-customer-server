import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { REQUEST_MAX, SUMMARY_MAX } from '../feature-requests.store';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** A request the customer typed on the My requests page (not through the AI). */
export class CreateFeatureRequestDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Say what you would like' })
  @MaxLength(SUMMARY_MAX)
  summary!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(REQUEST_MAX)
  request?: string;
}
