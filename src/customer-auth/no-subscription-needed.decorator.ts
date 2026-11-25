import { SetMetadata } from '@nestjs/common';

export const NO_SUBSCRIPTION_NEEDED = 'noSubscriptionNeeded';

/**
 * 2026-11-25: a route (or controller) a LOCKED customer may still use — sign-in, their
 * profile, billing. Every other `CustomerJwtGuard` route answers 402 without an active
 * plan or trial.
 */
export const NoSubscriptionNeeded = () =>
  SetMetadata(NO_SUBSCRIPTION_NEEDED, true);
