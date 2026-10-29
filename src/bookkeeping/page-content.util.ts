/**
 * Which pages of a statement have nothing a transaction could be read from — so they are
 * never sent to the model.
 *
 * Found 2026-10-28 (Madam recovery): asked to read a BLANK page, or a page of legal notice,
 * or a page holding only a tiny QR code, gpt-4o / gpt-4.1 INVENTED rows — $700, $7,000,
 * $8,500 of deposits on a statement whose only transaction was $0.29 of interest — and one
 * such read looped until the 16k-token cap, failing the whole statement. Every re-read made
 * it worse, since the hint says "a row is probably missing".
 *
 * A page is empty when its text layer holds no money-shaped figure AND either it is a page
 * of text (`TEXT_PAGE_CHARS`) or it has no image big enough to be a scan or a cheque
 * (`MIN_IMAGE_AREA_SHARE`). A scanned statement (no text layer, a full-page image) is
 * therefore still read. Page 1 is never skipped:
 * it carries the account and the period every other page is read against.
 *
 * ⚠️ Fails OPEN: if mupdf cannot look, every page is read exactly as before.
 */
import type { Box } from './pdf-images';

/** A figure with cents, as statements print amounts: 1,234.56 / 0.29 / -45.00. */
const MONEY = /\d[\d,]*[.,]\d{2}(?!\d)/;
/** "Page 2 of 4" footers (and "Page 2") carry no amount but must not count as text either way. */
const PAGE_FOOTER = /\bpage\s+\d+(\s+of\s+\d+)?\b/gi;
/**
 * An image covering less of the page than this is a logo, a header banner or a QR code —
 * not a scan or a cheque. By AREA, not width: BMO's "Business Banking" banner is over a
 * quarter of the page wide but ~4% of its area; a cheque image is ~14%, a scan ~100%.
 */
const MIN_IMAGE_AREA_SHARE = 0.08;
/**
 * Non-space characters past which a page is a page of TEXT (a notice, terms), not a scan.
 * High enough that a cheque-image page with a short header ("Business Banking statement,
 * <company>, For the period ending …", ~150) is still read for its cheques.
 */
const TEXT_PAGE_CHARS = 400;

export interface PageContent {
  text: string;
  images: Box[];
  bounds: Box;
}

/** True when the page cannot hold a transaction. Pure. */
export function pageHasNothingToRead(content: PageContent): boolean {
  const text = content.text.replace(PAGE_FOOTER, ' ');
  if (MONEY.test(text)) return false;
  // A page with plenty of text and not one amount is a notice, whatever images it has:
  // BMO draws every page on a FULL-PAGE background image, so image size alone cannot tell
  // its trustee notice from a scan. A scan has (almost) no text layer.
  if (text.replace(/\s/g, '').length >= TEXT_PAGE_CHARS) return true;
  const area = (b: Box) =>
    Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const pageArea = area(content.bounds);
  const bigImage = content.images.some(
    (b) => area(b) >= pageArea * MIN_IMAGE_AREA_SHARE,
  );
  return !bigImage;
}

/** The 0-based pages to skip; page 0 never. Pure. */
export function pagesToSkip(contents: readonly PageContent[]): Set<number> {
  const skip = new Set<number>();
  contents.forEach((c, i) => {
    if (i > 0 && pageHasNothingToRead(c)) skip.add(i);
  });
  return skip;
}

/** Each page's text and image boxes, via mupdf. Null when mupdf cannot look (fail open). */
export async function pageContents(pdf: Buffer): Promise<PageContent[] | null> {
  try {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
    try {
      if (doc.needsPassword()) return null;
      const out: PageContent[] = [];
      const count = doc.countPages();
      for (let i = 0; i < count; i++) {
        const page = doc.loadPage(i);
        try {
          const images: Box[] = [];
          const st = page.toStructuredText('preserve-images');
          try {
            st.walk({ onImageBlock: (bbox) => images.push([...bbox] as Box) });
            out.push({
              text: st.asText(),
              images,
              bounds: page.getBounds() as Box,
            });
          } finally {
            st.destroy();
          }
        } finally {
          page.destroy();
        }
      }
      return out;
    } finally {
      doc.destroy();
    }
  } catch {
    return null;
  }
}
