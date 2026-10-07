/** A failure the customer should see as-is (not retried: retrying would fail the same way). */
export class UnreadableStatementError extends Error {}
