import { UNCLARIFIED_NAME } from './reports.util';

/**
 * step2 (2026-11-11): files live in the Names tab. Every file belongs to ONE name (its
 * folder there) and counts in ONE of three buckets. Pure, so it is tested; the client
 * shows what the server decides (`AttachmentView.nameKey` / `bucket`).
 */

/**
 * RELATED = on a transaction · DOCUMENT = not a transaction (a contract, a letter) ·
 * ERROR = a payment we could not match (or could not read) · READING = still being read.
 */
export type FileBucket = 'RELATED' | 'DOCUMENT' | 'ERROR' | 'READING';

export interface NameInput {
  /** The customer moved it to this name (`TransactionAttachment.nameOverride`). */
  nameOverride: string | null;
  /** The transaction it is on — null when unmatched or its statement left the ledger. */
  transaction: { name: string | null } | null;
  reading: {
    vendor?: string | null;
    payee?: string | null;
    party?: string | null;
  } | null;
}

const clean = (s: string | null | undefined): string | null => {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 191) : null;
};

/**
 * Which name's folder a file sits in: the customer's own choice → the matched
 * transaction's name (it already follows their renames; a matched row with no name is
 * "Unclarified name") → who the AI read on it (vendor, payee, the other party). Null =
 * Unsorted.
 */
export function attachmentName(a: NameInput): string | null {
  const own = clean(a.nameOverride);
  if (own) return own;
  if (a.transaction) return clean(a.transaction.name) ?? UNCLARIFIED_NAME;
  const r = a.reading;
  return clean(r?.vendor) ?? clean(r?.payee) ?? clean(r?.party) ?? null;
}

/** The key names are matched on — case and spacing never make two folders. */
export const nameKeyOf = (name: string): string =>
  name.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The bucket from the row's status: MATCHED on a live transaction = RELATED; DOCUMENT =
 * not a transaction; UNMATCHED / FAILED (or MATCHED to a transaction that left the
 * ledger) = ERROR; PENDING / PROCESSING = READING. A file with no name is an error too —
 * it waits in Unsorted until the customer files it (`unsorted`).
 */
export function fileBucket(
  status: string,
  onTransaction: boolean,
  unsorted: boolean,
): FileBucket {
  if (status === 'PENDING' || status === 'PROCESSING') return 'READING';
  if (onTransaction) return 'RELATED';
  if (unsorted) return 'ERROR';
  if (status === 'DOCUMENT') return 'DOCUMENT';
  return 'ERROR';
}
