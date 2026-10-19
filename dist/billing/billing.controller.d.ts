import { type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { BookScope } from '../bookkeeping/scope';
import type { CustomerRequestUser } from '../customer-auth/customer-jwt.strategy';
import { BillingService, type BillingConfigView, type CheckoutView, type QuoteView, type SavedCardView } from './billing.service';
import { CheckoutDto, CompleteDto, QuoteDto } from './dto/billing.dto';
type AuthedRequest = Request & {
    user: CustomerRequestUser;
};
export declare class BillingController {
    private readonly billing;
    constructor(billing: BillingService);
    config(): Promise<BillingConfigView>;
    quote(dto: QuoteDto): Promise<QuoteView>;
    cards(req: AuthedRequest): Promise<SavedCardView[]>;
    removeCard(req: AuthedRequest, id: string): Promise<void>;
    checkout(scope: BookScope, dto: CheckoutDto): Promise<CheckoutView>;
    complete(scope: BookScope, dto: CompleteDto): Promise<{
        queued: number;
        taxing: boolean;
    }>;
}
export declare class BillingWebhookController {
    private readonly billing;
    constructor(billing: BillingService);
    webhook(req: RawBodyRequest<Request>, signature: string | undefined): Promise<{
        received: true;
    }>;
}
export {};
