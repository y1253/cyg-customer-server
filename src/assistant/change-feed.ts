/**
 * step12h: "something in this customer's books changed" — so an open website page refreshes
 * by itself when the AI changed something on ANOTHER channel (a text, a call, an email, the
 * strong AI after a call) or a statement / receipt finished reading.
 *
 * The page polls `GET /api/assistant/changes` (a few bytes) and refetches when the version
 * moves. In memory, which is safe because pm2 runs the API in fork mode; the boot time is
 * part of the version, so after a restart every open page refreshes once. A plain module
 * (no Nest provider) so the bookkeeping and bank-feed queues can bump it without importing
 * the assistant module.
 */

const boot = Date.now().toString(36);
const versions = new Map<number, number>();

export const changeFeed = {
  bump(customerId: number | null | undefined): void {
    if (!customerId) return;
    versions.set(customerId, (versions.get(customerId) ?? 0) + 1);
  },
  version(customerId: number): string {
    return `${boot}.${versions.get(customerId) ?? 0}`;
  },
};
