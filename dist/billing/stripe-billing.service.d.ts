import { type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type BillingTransaction, type CustomerSubscription } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from './stripe.client';
import { SubscriptionService, type AccessState } from './subscription.service';
export interface PlanPrice {
    priceCents: number;
    currency: string;
    interval: string;
}
export interface BillingTransactionView {
    id: number;
    kind: BillingTransaction['kind'];
    status: BillingTransaction['status'];
    amountCents: number;
    currency: string;
    failureMessage: string | null;
    declineCode: string | null;
    nextRetryAt: string | null;
    cardBrand: string | null;
    cardLast4: string | null;
    hostedInvoiceUrl: string | null;
    invoicePdfUrl: string | null;
    receiptUrl: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    promoCode: string | null;
    occurredAt: string;
}
export interface SubscriptionView {
    access: AccessState;
    price: PlanPrice | null;
    status: CustomerSubscription['status'];
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    freeUntil: string | null;
    freeForever: boolean;
    failedSince: string | null;
    lastFailureMessage: string | null;
    card: {
        brand: string;
        last4: string;
    } | null;
    hasStripeCustomer: boolean;
    transactions: BillingTransactionView[];
}
export declare class StripeBillingService implements OnModuleInit {
    private readonly prisma;
    private readonly config;
    private readonly stripeClient;
    private readonly subs;
    private readonly logger;
    private priceCache;
    private syncing;
    constructor(prisma: PrismaService, config: ConfigService, stripeClient: StripeClient, subs: SubscriptionService);
    onModuleInit(): void;
    price(): Promise<PlanPrice | null>;
    view(customerId: number): Promise<SubscriptionView>;
    startCheckout(customerId: number): Promise<{
        url: string;
    }>;
    portal(customerId: number): Promise<{
        url: string;
    }>;
    redeemPromo(customerId: number, code: string): Promise<{
        freeUntil: string | null;
        freeForever: boolean;
    }>;
    handleWebhook(rawBody: Buffer, signature: string): Promise<void>;
    syncSubscription(subscriptionId: string): Promise<void>;
    private onInvoice;
    private recordInvoice;
    private onRefund;
    private onDispute;
    private write;
    syncAll(): Promise<void>;
    private syncInvoices;
    private adoptMissing;
    private customerOf;
    ensureStripeCustomer(customerId: number): Promise<string>;
}
export declare function money(cents: number, currency: string): string;
