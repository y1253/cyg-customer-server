import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** The ID token Google Identity Services hands the browser. Verified server-side. */
export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  credential!: string;
}
