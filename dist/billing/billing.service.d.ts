import { type PromoCode } from '@prisma/client';
import Stripe from 'stripe';
import { BookkeepingService } from '../bookkeeping/bookkeeping.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from './stripe.client';
export interface QuoteView {
    listPriceCents: number;
    amountCents: number;
    currency: string;
    promo: {
        code: string;
        kind: PromoCode['kind'];
        value: number;
    } | null;
}
export interface BillingConfigView {
    publishableKey: string | null;
    priceCents: number;
    currency: string;
}
export interface SavedCardView {
    id: string;
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
}
type GenerateResult = {
    queued: number;
    taxing: boolean;
};
export type CheckoutView = {
    done: true;
    amountCents: number;
    result: GenerateResult;
} | {
    done: false;
    amountCents: number;
    clientSecret: string;
    paymentIntentId: string;
    status: Stripe.PaymentIntent.Status;
};
export declare class BillingService {
    private readonly prisma;
    private readonly stripeClient;
    private readonly bookkeeping;
    private readonly logger;
    constructor(prisma: PrismaService, stripeClient: StripeClient, bookkeeping: BookkeepingService);
    config(): Promise<BillingConfigView>;
    quote(promoCode?: string): Promise<QuoteView>;
    cards(customerId: number): Promise<SavedCardView[]>;
    removeCard(customerId: number, paymentMethodId: string): Promise<void>;
    checkout(customerId: number, promoCode: string | undefined, paymentMethodId: string | undefined): Promise<CheckoutView>;
    complete(customerId: number, paymentIntentId: string): Promise<GenerateResult>;
    handleWebhook(rawBody: Buffer, signature: string): Promise<void>;
    private recordAndGenerate;
    private recordFree;
    private generateFor;
    private usablePromo;
    private stripeCustomerIdOf;
    private ensureStripeCustomer;
    private ownCard;
    private retrieveIntent;
    private cardError;
}
export {};
