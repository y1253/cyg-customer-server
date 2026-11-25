import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module';
import {
  BillingController,
  BillingWebhookController,
} from './billing.controller';

/** The billing routes. The services live in the global `SubscriptionModule`. */
@Module({
  imports: [CustomerAuthModule],
  controllers: [BillingController, BillingWebhookController],
})
export class BillingModule {}
