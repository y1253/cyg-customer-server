import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class QuoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  promoCode?: string;
}

export class CheckoutDto extends QuoteDto {
  /** A saved card (`pm_…`) to charge at once; absent = the client collects a new card. */
  @IsOptional()
  @Matches(/^pm_[A-Za-z0-9]+$/, { message: 'Invalid card' })
  paymentMethodId?: string;
}

export class CompleteDto {
  @Matches(/^pi_[A-Za-z0-9]+$/, { message: 'Invalid payment' })
  paymentIntentId!: string;
}
