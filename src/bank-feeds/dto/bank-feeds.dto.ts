import { IsString, Matches, MaxLength } from 'class-validator';

export class ExchangeDto {
  /** Plaid Link's `public_token` (`public-<env>-<uuid>`). */
  @IsString()
  @MaxLength(200)
  @Matches(/^public-[a-z]+-[A-Za-z0-9-]+$/, {
    message: 'Invalid bank connection token',
  })
  publicToken!: string;
}
