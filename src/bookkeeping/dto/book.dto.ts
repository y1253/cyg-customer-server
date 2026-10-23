import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** step12c: a bookkeeping company's name (create / rename). */
export class BookNameDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Give the company a name' })
  @MaxLength(120)
  name!: string;
}
