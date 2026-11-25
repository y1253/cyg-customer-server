/**
 * 2026-11-25: the few places deep in other modules (the messenger, the cost recorder) that
 * must ask "may this customer still be sent an AI text?" or say "usage changed" without
 * importing the billing module (it imports them). `SubscriptionService` fills these in at
 * start, like `change-feed.ts`. Unset (a script, a spec) = allowed / nothing.
 */
export const billingHooks: {
  /** False = do not send this AI text (the free trial's texts are used up). */
  allowText?: (customerId: number, purpose: string) => Promise<boolean>;
  /** A text / call / transaction was recorded for this customer: drop cached counts. */
  usageChanged?: (customerId: number) => void;
} = {};
