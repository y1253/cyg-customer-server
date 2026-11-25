import type { BillingTransactionKind, BillingTransactionStatus } from '@prisma/client';
import type Stripe from 'stripe';
export interface TransactionFields {
    recordKey: string;
    stripeInvoiceId: string | null;
    stripePaymentIntentId: string | null;
    stripeChargeId: string | null;
    kind: BillingTransactionKind;
    status: BillingTransactionStatus;
    amountCents: number;
    currency: string;
    attemptCount: number | null;
    failureCode: string | null;
    declineCode: string | null;
    failureMessage: string | null;
    nextRetryAt: Date | null;
    cardBrand: string | null;
    cardLast4: string | null;
    cardExpMonth: number | null;
    cardExpYear: number | null;
    hostedInvoiceUrl: string | null;
    invoicePdfUrl: string | null;
    receiptUrl: string | null;
    periodStart: Date | null;
    periodEnd: Date | null;
    occurredAt: Date;
}
export type InvoiceOutcome = 'paid' | 'failed' | 'action_required';
export declare function subscriptionIdOfInvoice(inv: Stripe.Invoice): string | null;
export declare function paymentIntentOfInvoice(inv: Stripe.Invoice): Stripe.PaymentIntent | null;
export declare function kindOfInvoice(inv: Stripe.Invoice): BillingTransactionKind;
export declare function invoiceTransaction(inv: Stripe.Invoice, outcome: InvoiceOutcome, occurredAt: Date): TransactionFields;
export declare function chargeTransaction(charge: Stripe.Charge, kind: 'REFUND' | 'DISPUTE', occurredAt: Date, amountCents: number, keySuffix: string): TransactionFields;
export declare function periodOfSubscription(sub: Stripe.Subscription): {
    start: Date | null;
    end: Date | null;
};
export declare function trimmed(obj: object): Record<string, unknown>;
