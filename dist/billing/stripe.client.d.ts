import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
export declare class StripeClient {
    private readonly config;
    private client;
    constructor(config: ConfigService);
    get configured(): boolean;
    get publishableKey(): string | null;
    get webhookSecret(): string | null;
    get stripe(): Stripe;
}
