/**
 * WHOSE books a request or a queued row works on (step8, 2026-10-19).
 *
 * A customer keeps one general set of books (`companyId: null`, every row from before
 * step8) plus one separate set per business they registered (`companyId` = that
 * `Company.id`, opened from "My businesses"). Every bookkeeping table that carries
 * `customerId` also carries `companyId`, and EVERY read and write is filtered on both —
 * so a statement, rule, category or agency of one book is never seen by another.
 *
 * ⚠️ Filter with `scopeWhere(scope)`, never `{ customerId }` alone: Prisma treats an
 * absent `companyId` as "any", which would mix the general book with every company's.
 * `companyId: null` in a `where` is an IS NULL test, which is exactly the general book.
 *
 * The firm-wide memories (`DescriptionMemory`, `NameMemory`, `ProductMemory`, `FxRate`)
 * are NOT scoped — they never held one customer's data to begin with.
 */
export interface BookScope {
  customerId: number;
  /** null = the customer's general bookkeeping tool. */
  companyId: number | null;
}

/** The `where` (and `data`) pair that pins a query to one book. */
export function scopeWhere(scope: BookScope): {
  customerId: number;
  companyId: number | null;
} {
  return { customerId: scope.customerId, companyId: scope.companyId };
}

/** A row's own book — how the background queues know whose rules a statement uses. */
export function scopeOf(row: {
  customerId: number;
  companyId: number | null;
}): BookScope {
  return { customerId: row.customerId, companyId: row.companyId };
}

/** The general book of a customer (texted receipts, and every pre-step8 caller). */
export function generalScope(customerId: number): BookScope {
  return { customerId, companyId: null };
}

/**
 * The R2 key prefix for one book's files. The general book keeps the pre-step8 layout,
 * so existing keys and new ones agree; a company's files sit under it.
 */
export function storagePrefix(scope: BookScope): string {
  return scope.companyId === null
    ? `bookkeeping/${scope.customerId}`
    : `bookkeeping/${scope.customerId}/companies/${scope.companyId}`;
}

/** "customer 7" or "customer 7 company 3" — for log lines. */
export function bookLabel(scope: BookScope): string {
  return scope.companyId === null
    ? `customer ${scope.customerId}`
    : `customer ${scope.customerId} company ${scope.companyId}`;
}
