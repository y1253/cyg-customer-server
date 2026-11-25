import { type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import { RedeemDto } from './dto/billing.dto';
import { StripeBillingService, type PlanPrice, type SubscriptionView } from './stripe-billing.service';
type AuthedRequest = Request & {
    user: CustomerRequestUser;
};
export declare class BillingController {
    private readonly billing;
    constructor(billing: StripeBillingService);
    config(): Promise<{
        price: PlanPrice | null;
    }>;
    subscription(req: AuthedRequest): Promise<SubscriptionView>;
    subscribe(req: AuthedRequest): Promise<{
        url: string;
    }>;
    portal(req: AuthedRequest): Promise<{
        url: string;
    }>;
    redeem(req: AuthedRequest, dto: RedeemDto): Promise<{
        freeUntil: string | null;
        freeForever: boolean;
    }>;
}
export declare class BillingWebhookController {
    private readonly billing;
    constructor(billing: StripeBillingService);
    webhook(req: RawBodyRequest<Request>, signature: string | undefined): Promise<{
        received: true;
    }>;
}
export {};
