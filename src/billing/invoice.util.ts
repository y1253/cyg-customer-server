import type {
  BillingTransactionKind,
  BillingTransactionStatus,
} from '@prisma/client';
import type Stripe from 'stripe';

/**
 * Stripe invoice / charge → one `BillingTransaction` row (pure; the service fetches and
 * expands the objects). Never throws on a missing field — Stripe moves fields between API
 * versions, and a row with a blank card is better than no row.
 */
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

const at = (s: number | null | undefined): Date | null =>
  typeof s === 'number' && s > 0 ? new Date(s * 1000) : null;

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  !v ? null : typeof v === 'string' ? v : v.id;

/** The subscription an invoice belongs to (moved under `parent` in API 2025-03+). */
export function subscriptionIdOfInvoice(inv: Stripe.Invoice): string | null {
  const parent = inv.parent?.subscription_details?.subscription;
  if (parent) return idOf(parent);
  const legacy = (inv as unknown as { subscription?: string | { id: string } })
    .subscription;
  return idOf(legacy ?? null);
}

/** The invoice's PaymentIntent (expanded through `payments`), else null. */
export function paymentIntentOfInvoice(
  inv: Stripe.Invoice,
): Stripe.PaymentIntent | null {
  const list = inv.payments?.data ?? [];
  // The default (current) payment first.
  const sorted = [...list].sort(
    (a, b) => Number(b.is_default) - Number(a.is_default),
  );
  for (const p of sorted) {
    const pi = p.payment?.payment_intent;
    if (pi && typeof pi === 'object') return pi;
  }
  return null;
}

/** First / renewal / anything else (plan change, manual). */
export function kindOfInvoice(inv: Stripe.Invoice): BillingTransactionKind {
  if (inv.billing_reason === 'subscription_create') return 'SUBSCRIPTION_START';
  if (inv.billing_reason === 'subscription_cycle') return 'RENEWAL';
  return 'PRORATION';
}

const STATUS: Record<InvoiceOutcome, BillingTransactionStatus> = {
  paid: 'SUCCEEDED',
  failed: 'FAILED',
  action_required: 'ACTION_REQUIRED',
};

/**
 * One row for an invoice event. The key is per invoice + outcome + attempt, so the webhook
 * and the hourly sync write a paid invoice once, and every failed RETRY is its own row.
 */
export function invoiceTransaction(
  inv: Stripe.Invoice,
  outcome: InvoiceOutcome,
  occurredAt: Date,
): TransactionFields {
  const pi = paymentIntentOfInvoice(inv);
  const charge =
    pi && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const card = charge?.payment_method_details?.card ?? null;
  const pmCard =
    pi && typeof pi.payment_method === 'object'
      ? (pi.payment_method?.card ?? null)
      : null;
  const err = pi?.last_payment_error ?? null;
  const line = inv.lines?.data?.[0];
  const attempt = outcome === 'paid' ? 'ok' : String(inv.attempt_count ?? 0);
  return {
    recordKey: `inv:${inv.id}:${outcome}:${attempt}`,
    stripeInvoiceId: inv.id ?? null,
    stripePaymentIntentId: pi?.id ?? null,
    stripeChargeId: charge?.id ?? null,
    kind: kindOfInvoice(inv),
    status: STATUS[outcome],
    amountCents:
      outcome === 'paid' ? inv.amount_paid || inv.amount_due : inv.amount_due,
    currency: inv.currency,
    attemptCount: inv.attempt_count ?? null,
    failureCode: outcome === 'paid' ? null : (err?.code ?? null),
    declineCode: outcome === 'paid' ? null : (err?.decline_code ?? null),
    failureMessage:
      outcome === 'paid'
        ? null
        : (err?.message ??
            (outcome === 'action_required'
              ? 'The bank asks the customer to confirm the payment (3-D Secure).'
              : 'The payment failed.')
          ).slice(0, 500),
    nextRetryAt: outcome === 'failed' ? at(inv.next_payment_attempt) : null,
    cardBrand: card?.brand ?? pmCard?.brand ?? null,
    cardLast4: card?.last4 ?? pmCard?.last4 ?? null,
    cardExpMonth: card?.exp_month ?? pmCard?.exp_month ?? null,
    cardExpYear: card?.exp_year ?? pmCard?.exp_year ?? null,
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdfUrl: inv.invoice_pdf ?? null,
    receiptUrl: charge?.receipt_url ?? null,
    periodStart: at(line?.period?.start) ?? at(inv.period_start),
    periodEnd: at(line?.period?.end) ?? at(inv.period_end),
    occurredAt,
  };
}

/** A refund (`charge.refunded`) or a dispute (`charge.dispute.created`) of a charge. */
export function chargeTransaction(
  charge: Stripe.Charge,
  kind: 'REFUND' | 'DISPUTE',
  occurredAt: Date,
  amountCents: number,
  keySuffix: string,
): TransactionFields {
  const card = charge.payment_method_details?.card ?? null;
  return {
    recordKey: `ch:${charge.id}:${kind.toLowerCase()}:${keySuffix}`,
    stripeInvoiceId: null,
    stripePaymentIntentId: idOf(charge.payment_intent),
    stripeChargeId: charge.id,
    kind,
    status: kind === 'REFUND' ? 'REFUNDED' : 'DISPUTED',
    amountCents,
    currency: charge.currency,
    attemptCount: null,
    failureCode: null,
    declineCode: null,
    failureMessage: null,
    nextRetryAt: null,
    cardBrand: card?.brand ?? null,
    cardLast4: card?.last4 ?? null,
    cardExpMonth: card?.exp_month ?? null,
    cardExpYear: card?.exp_year ?? null,
    hostedInvoiceUrl: null,
    invoicePdfUrl: null,
    receiptUrl: charge.receipt_url ?? null,
    periodStart: null,
    periodEnd: null,
    occurredAt,
  };
}

/** The subscription's billing period (on its first item since API 2025-03). */
export function periodOfSubscription(sub: Stripe.Subscription): {
  start: Date | null;
  end: Date | null;
} {
  const item = sub.items?.data?.[0];
  const legacy = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  return {
    start: at(item?.current_period_start ?? legacy.current_period_start),
    end: at(item?.current_period_end ?? legacy.current_period_end),
  };
}

/** A small copy of a Stripe object for support (`BillingTransaction.raw`). */
export function trimmed(obj: object): Record<string, unknown> {
  const keep = [
    'id',
    'object',
    'status',
    'billing_reason',
    'amount_due',
    'amount_paid',
    'amount_refunded',
    'attempt_count',
    'currency',
    'customer',
    'next_payment_attempt',
    'reason',
  ];
  const out: Record<string, unknown> = {};
  for (const k of keep)
    if (k in obj) out[k] = (obj as Record<string, unknown>)[k];
  return out;
}
