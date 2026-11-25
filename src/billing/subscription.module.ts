import { Global, Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { StripeBillingService } from './stripe-billing.service';
import { StripeClient } from './stripe.client';
import { SubscriptionService } from './subscription.service';

/**
 * 2026-11-25: who may use the app and how much (`SubscriptionService`), and the Stripe
 * subscription behind it (`StripeBillingService`). Global: the customer JWT guard, the
 * statement / bank-feed queues, the voice bridge and the AI channels all ask it.
 */
@Global()
@Module({
  imports: [MessagingModule],
  providers: [StripeClient, SubscriptionService, StripeBillingService],
  exports: [StripeClient, SubscriptionService, StripeBillingService],
})
export class SubscriptionModule {}
