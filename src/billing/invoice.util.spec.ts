import type Stripe from 'stripe';
import {
  chargeTransaction,
  invoiceTransaction,
  periodOfSubscription,
  subscriptionIdOfInvoice,
} from './invoice.util';

const when = new Date('2026-11-25T12:00:00Z');

function invoice(over: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: 'in_1',
    billing_reason: 'subscription_cycle',
    amount_due: 1999,
    amount_paid: 0,
    currency: 'cad',
    attempt_count: 1,
    next_payment_attempt: 1_764_200_000,
    hosted_invoice_url: 'https://invoice.stripe.com/i/1',
    invoice_pdf: 'https://pay.stripe.com/invoice/1/pdf',
    period_start: 1_761_000_000,
    period_end: 1_763_600_000,
    parent: {
      subscription_details: { subscription: 'sub_1', metadata: { customerId: '7' } },
    },
    lines: { data: [{ period: { start: 1_763_600_000, end: 1_766_200_000 } }] },
    payments: {
      data: [
        {
          is_default: true,
          payment: {
            payment_intent: {
              id: 'pi_1',
              last_payment_error: {
                code: 'card_declined',
                decline_code: 'insufficient_funds',
                message: 'Your card has insufficient funds.',
              },
              latest_charge: {
                id: 'ch_1',
                receipt_url: null,
                payment_method_details: {
                  card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2029 },
                },
              },
            },
          },
        },
      ],
    },
    ...over,
  } as unknown as Stripe.Invoice;
}

describe('invoiceTransaction', () => {
  it('a failed renewal keeps Stripe’s reason, the card and the next try', () => {
    const t = invoiceTransaction(invoice(), 'failed', when);
    expect(t).toMatchObject({
      recordKey: 'inv:in_1:failed:1',
      kind: 'RENEWAL',
      status: 'FAILED',
      amountCents: 1999,
      failureCode: 'card_declined',
      declineCode: 'insufficient_funds',
      failureMessage: 'Your card has insufficient funds.',
      cardBrand: 'visa',
      cardLast4: '4242',
      stripePaymentIntentId: 'pi_1',
      stripeChargeId: 'ch_1',
    });
    expect(t.nextRetryAt?.getTime()).toBe(1_764_200_000_000);
    expect(t.periodStart?.getTime()).toBe(1_763_600_000_000);
  });

  it('every failed retry is its own row; a paid invoice has one key', () => {
    const second = invoiceTransaction(invoice({ attempt_count: 2 }), 'failed', when);
    expect(second.recordKey).toBe('inv:in_1:failed:2');
    const paid = invoiceTransaction(
      invoice({ billing_reason: 'subscription_create', amount_paid: 1999, attempt_count: 3 }),
      'paid',
      when,
    );
    expect(paid).toMatchObject({
      recordKey: 'inv:in_1:paid:ok',
      kind: 'SUBSCRIPTION_START',
      status: 'SUCCEEDED',
      failureMessage: null,
      declineCode: null,
      nextRetryAt: null,
    });
  });

  it('needs 3-D Secure → ACTION_REQUIRED with the invoice link', () => {
    const t = invoiceTransaction(
      invoice({ payments: { data: [] } }),
      'action_required',
      when,
    );
    expect(t.status).toBe('ACTION_REQUIRED');
    expect(t.hostedInvoiceUrl).toBe('https://invoice.stripe.com/i/1');
    expect(t.failureMessage).toContain('3-D Secure');
    expect(t.cardLast4).toBeNull();
  });
});

describe('subscriptionIdOfInvoice', () => {
  it('reads parent.subscription_details, and the old field', () => {
    expect(subscriptionIdOfInvoice(invoice())).toBe('sub_1');
    expect(
      subscriptionIdOfInvoice(invoice({ parent: null, subscription: 'sub_old' })),
    ).toBe('sub_old');
    expect(subscriptionIdOfInvoice(invoice({ parent: null }))).toBeNull();
  });
});

describe('chargeTransaction', () => {
  it('a refund is keyed by its refunded total', () => {
    const t = chargeTransaction(
      {
        id: 'ch_9',
        currency: 'cad',
        payment_intent: 'pi_9',
        receipt_url: 'https://r',
        payment_method_details: { card: { brand: 'mastercard', last4: '1111' } },
      } as unknown as Stripe.Charge,
      'REFUND',
      when,
      1999,
      '1999',
    );
    expect(t).toMatchObject({
      recordKey: 'ch:ch_9:refund:1999',
      status: 'REFUNDED',
      amountCents: 1999,
      stripePaymentIntentId: 'pi_9',
      cardLast4: '1111',
    });
  });
});

describe('periodOfSubscription', () => {
  it('reads the period from the first item (API 2025-03+)', () => {
    const p = periodOfSubscription({
      items: { data: [{ current_period_start: 100, current_period_end: 200 }] },
    } as unknown as Stripe.Subscription);
    expect(p.start?.getTime()).toBe(100_000);
    expect(p.end?.getTime()).toBe(200_000);
  });
});
