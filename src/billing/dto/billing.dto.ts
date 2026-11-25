import { IsString, MaxLength, MinLength } from 'class-validator';

export class RedeemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  promoCode!: string;
}
