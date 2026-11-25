import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * The one Stripe SDK instance. Built lazily, so the server starts (and every free route
 * works) without keys; a paid route then answers 503 instead of crashing on boot.
 * `STRIPE_SECRET_KEY` may be a restricted key (`rk_…`): Customers, Checkout Sessions,
 * Subscriptions and Billing Portal write; Invoices, Prices, Charges and Disputes read.
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

  /** 2026-11-25: the monthly plan's Stripe price (`price_…`). */
  get priceId(): string | null {
    return this.config.get<string>('STRIPE_SUBSCRIPTION_PRICE_ID')?.trim() || null;
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
