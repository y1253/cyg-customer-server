"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionIdOfInvoice = subscriptionIdOfInvoice;
exports.paymentIntentOfInvoice = paymentIntentOfInvoice;
exports.kindOfInvoice = kindOfInvoice;
exports.invoiceTransaction = invoiceTransaction;
exports.chargeTransaction = chargeTransaction;
exports.periodOfSubscription = periodOfSubscription;
exports.trimmed = trimmed;
const at = (s) => typeof s === 'number' && s > 0 ? new Date(s * 1000) : null;
const idOf = (v) => !v ? null : typeof v === 'string' ? v : v.id;
function subscriptionIdOfInvoice(inv) {
    const parent = inv.parent?.subscription_details?.subscription;
    if (parent)
        return idOf(parent);
    const legacy = inv
        .subscription;
    return idOf(legacy ?? null);
}
function paymentIntentOfInvoice(inv) {
    const list = inv.payments?.data ?? [];
    const sorted = [...list].sort((a, b) => Number(b.is_default) - Number(a.is_default));
    for (const p of sorted) {
        const pi = p.payment?.payment_intent;
        if (pi && typeof pi === 'object')
            return pi;
    }
    return null;
}
function kindOfInvoice(inv) {
    if (inv.billing_reason === 'subscription_create')
        return 'SUBSCRIPTION_START';
    if (inv.billing_reason === 'subscription_cycle')
        return 'RENEWAL';
    return 'PRORATION';
}
const STATUS = {
    paid: 'SUCCEEDED',
    failed: 'FAILED',
    action_required: 'ACTION_REQUIRED',
};
function invoiceTransaction(inv, outcome, occurredAt) {
    const pi = paymentIntentOfInvoice(inv);
    const charge = pi && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
    const card = charge?.payment_method_details?.card ?? null;
    const pmCard = pi && typeof pi.payment_method === 'object'
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
        amountCents: outcome === 'paid' ? inv.amount_paid || inv.amount_due : inv.amount_due,
        currency: inv.currency,
        attemptCount: inv.attempt_count ?? null,
        failureCode: outcome === 'paid' ? null : (err?.code ?? null),
        declineCode: outcome === 'paid' ? null : (err?.decline_code ?? null),
        failureMessage: outcome === 'paid'
            ? null
            : (err?.message ??
                (outcome === 'action_required'
                    ? 'The bank asks the customer to confirm the payment (3-D Secure).'
                    : 'The payment failed.')).slice(0, 500),
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
function chargeTransaction(charge, kind, occurredAt, amountCents, keySuffix) {
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
function periodOfSubscription(sub) {
    const item = sub.items?.data?.[0];
    const legacy = sub;
    return {
        start: at(item?.current_period_start ?? legacy.current_period_start),
        end: at(item?.current_period_end ?? legacy.current_period_end),
    };
}
function trimmed(obj) {
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
    const out = {};
    for (const k of keep)
        if (k in obj)
            out[k] = obj[k];
    return out;
}
//# sourceMappingURL=invoice.util.js.map