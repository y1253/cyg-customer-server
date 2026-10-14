/**
 * Retry timing shared by the statement and attachment queues. Its own file so the
 * attachment queue need not import `statement-processor.service` (which imports
 * `statement-images.service`, which imports the attachment queue — a cycle Nest
 * cannot resolve at boot).
 */
export const MAX_ATTEMPTS = 4;
/** Wait before attempt n+1 (index = attempts so far): 1 min, 5 min, 30 min. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];

/** When a row with `attempts` failures may be claimed again. */
export function claimableAt(updatedAt: Date, attempts: number): number {
  if (attempts === 0) return updatedAt.getTime();
  const delay =
    RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
  return updatedAt.getTime() + delay;
}
