/**
 * step12: the model never copies a file link.
 *
 * A file link is `<base>/api/f/<jwt>` — about 300 characters of base64. Asked to repeat one,
 * the model re-typed it and changed characters (2026-10-22: a report link whose `exp − iat` was
 * 604822, never the 604800 our signer writes), so the signature failed and the customer got
 * "This link has expired". So `get_link` hands the model a short placeholder (`[[link:1]]`),
 * keeps the real URL in the run's `LinkBook`, and `fillLinks` swaps it in after the model has
 * answered. Any `/api/f/` URL the model wrote itself — re-typed, or copied from an older
 * message in the history — is never sent: it is replaced with a request for a fresh one.
 */

/** Placeholder → real URL, for one answer (chat) or one phone call (voice). */
export type LinkBook = Map<string, string>;

/** What the customer reads where a link could not be trusted. */
export const FRESH_LINK_HINT = '(ask me for a fresh link)';

const PLACEHOLDER = /\[\[\s*link\s*:\s*(\d+)\s*\]\]/gi;
/** A file link of ours, whatever host the model wrote in front of it. */
const FILE_URL = /(?:https?:\/\/[^\s/()<>"']+)?\/api\/f\/[A-Za-z0-9._~-]+/g;

/** Keeps a real URL and returns the placeholder the model is given instead. */
export function addLink(book: LinkBook, url: string): string {
  for (const [key, value] of book) if (value === url) return key;
  const key = `[[link:${book.size + 1}]]`;
  book.set(key, url);
  return key;
}

/**
 * The model's text as the customer may see it: every `/api/f/` URL it wrote itself is
 * replaced with `FRESH_LINK_HINT` (only a URL issued in this run, character for character,
 * is kept), then every placeholder becomes its real URL (an unknown one → the hint).
 */
export function fillLinks(text: string, book?: LinkBook | null): string {
  const issued = new Set(book?.values() ?? []);
  const cleaned = text.replace(FILE_URL, (url) =>
    issued.has(url) ? url : FRESH_LINK_HINT,
  );
  return cleaned.replace(
    PLACEHOLDER,
    (_m, n: string) => book?.get(`[[link:${Number(n)}]]`) ?? FRESH_LINK_HINT,
  );
}
