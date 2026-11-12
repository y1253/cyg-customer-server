import { ArrayMaxSize, IsArray, IsInt, Min } from 'class-validator';

/** "Read all again": the files shown in the list (`AttachmentsService.retryAll`). */
export class RetryAttachmentsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids!: number[];
}
