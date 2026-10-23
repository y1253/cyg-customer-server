/**
 * WHOSE books a request or a queued row works on.
 *
 * step12c (2026-10-23): a book is a `Book` row. A customer keeps any number of bookkeeping
 * companies ("Company1" is created automatically and holds every row from before step12c),
 * and each registered business (`Company`, "My businesses") has its own book linked by
 * `Book.companyId` — hidden from the Bookkeeping switcher. Every bookkeeping table carries
 * `customerId`, `bookId` AND `companyId` (= `Book.companyId`, kept so the internal app's
 * per-company mirrors keep working), and EVERY read and write is filtered on them — so a
 * statement, rule, category or agency of one book is never seen by another.
 *
 * ⚠️ Filter with `scopeWhere(scope)`, never `{ customerId }` alone: that mixes every book.
 *
 * The firm-wide memories (`DescriptionMemory`, `NameMemory`, `ProductMemory`, `FxRate`)
 * are NOT scoped — they never held one customer's data to begin with.
 */
export interface BookScope {
  customerId: number;
  /** The `Book` row. */
  bookId: number;
  /** Set = a registered business's book (`Book.companyId`); null = a bookkeeping company. */
  companyId: number | null;
}

/** The `where` (and `data`) triple that pins a query to one book. */
export function scopeWhere(scope: BookScope): {
  customerId: number;
  bookId: number;
  companyId: number | null;
} {
  return {
    customerId: scope.customerId,
    bookId: scope.bookId,
    companyId: scope.companyId,
  };
}

/** A row's own book — how the background queues know whose rules a statement uses. */
export function scopeOf(row: {
  customerId: number;
  bookId: number;
  companyId: number | null;
}): BookScope {
  return {
    customerId: row.customerId,
    bookId: row.bookId,
    companyId: row.companyId,
  };
}

/** The scope of a `Book` row. */
export function bookScope(book: {
  id: number;
  customerId: number;
  companyId: number | null;
}): BookScope {
  return {
    customerId: book.customerId,
    bookId: book.id,
    companyId: book.companyId,
  };
}

/**
 * The R2 key prefix for NEW files of one book. Rows store their full key, so files saved
 * under the pre-step12c layout (`bookkeeping/<customer>/` and `…/companies/<company>/`)
 * keep working.
 */
export function storagePrefix(scope: BookScope): string {
  return `bookkeeping/${scope.customerId}/books/${scope.bookId}`;
}

/** "customer 7 book 12" — for log lines. */
export function bookLabel(scope: BookScope): string {
  return `customer ${scope.customerId} book ${scope.bookId}`;
}
