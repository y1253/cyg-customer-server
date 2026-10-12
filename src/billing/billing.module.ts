import { Module } from '@nestjs/common';
import { BookkeepingModule } from '../bookkeeping/bookkeeping.module';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import {
  BillingController,
  BillingWebhookController,
} from './billing.controller';
import { BillingService } from './billing.service';
import { StripeClient } from './stripe.client';

@Module({
  imports: [CustomerAuthModule, BookkeepingModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [BillingService, StripeClient],
})
export class BillingModule {}
