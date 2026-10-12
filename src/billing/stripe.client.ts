import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * The one Stripe SDK instance. Built lazily, so the server starts (and every free route
 * works) without keys; a paid route then answers 503 instead of crashing on boot.
 * `STRIPE_SECRET_KEY` may be a restricted key (`rk_…`) with Customers, PaymentIntents and
 * PaymentMethods write + Charges read.
 */
@Injectable()
export class StripeClient {
  private client: Stripe | null = null;

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return Boolean(this.config.get<string>('STRIPE_SECRET_KEY')?.trim());
  }

  get publishableKey(): string | null {
    return this.config.get<string>('STRIPE_PUBLISHABLE_KEY')?.trim() || null;
  }

  get webhookSecret(): string | null {
    return this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim() || null;
  }

  get stripe(): Stripe {
    if (!this.client) {
      const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
      if (!key)
        throw new ServiceUnavailableException(
          'Payments are not set up yet — please contact us.',
        );
      this.client = new Stripe(key);
    }
    return this.client;
  }
}
