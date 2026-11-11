import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** step2 (2026-11-11): `PATCH bookkeeping/attachments/:id/place` — move or rename a file. */
export class PlaceAttachmentDto {
  /** The name to file it under; '' = back to what was read. Absent = unchanged. */
  @IsOptional()
  @IsString()
  @MaxLength(191)
  name?: string | null;

  /** The subfolder; null = the name's top. Absent = unchanged. */
  @IsOptional()
  @IsInt()
  @Min(1)
  folderId?: number | null;

  /** Its own name; '' = the original. Absent = unchanged. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string | null;
}

/** `POST bookkeeping/name-folders` — a subfolder under a name (none = Unsorted). */
export class CreateNameFolderDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  name?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  parentId?: number | null;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the folder a name' })
  @MaxLength(128)
  title!: string;
}

/** `PATCH bookkeeping/name-folders/:id` */
export class RenameNameFolderDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the folder a name' })
  @MaxLength(128)
  title!: string;
}

/** `POST bookkeeping/names` — a name added by hand. */
export class AddNameDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give the name' })
  @MaxLength(191)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^(CUSTOMER|SUPPLIER|OTHER|g\d+)$/, { message: 'Pick a group' })
  group?: string | null;
}

/** `POST bookkeeping/phone-upload-link` — where the phone's files go. */
export class PhoneUploadLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  name?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  folderId?: number | null;
}

/** `POST bookkeeping/welcome-email` */
export class WelcomeEmailDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Type an email address' })
  @MaxLength(191)
  to!: string;
}
