import {
  pageHasNothingToRead,
  pagesToSkip,
  type PageContent,
} from './page-content.util';
import type { Box } from './pdf-images';

const PAGE: Box = [0, 0, 612, 792];
const page = (text: string, images: Box[] = []): PageContent => ({
  text,
  images,
  bounds: PAGE,
});
const NOTICE = '2026 Trustee Notification — Collection of Beneficiary Information. '.repeat(
  10,
);

describe('pageHasNothingToRead', () => {
  it('a blank page (only its footer) is empty', () => {
    expect(pageHasNothingToRead(page('Page 2 of 4'))).toBe(true);
  });

  it('a page of notice text with no amount is empty, even on a full-page background', () => {
    // BMO (Madam recovery #327): the CDIC notice is drawn on a full-page image.
    expect(pageHasNothingToRead(page(NOTICE, [PAGE]))).toBe(true);
  });

  it('a tiny QR code does not make a page worth reading (Chase #292, page 4)', () => {
    expect(pageHasNothingToRead(page('', [[10, 700, 40, 730]]))).toBe(true);
  });

  it('a page with an amount is read', () => {
    expect(pageHasNothingToRead(page('Sep 03 Debit Card Purchase 126.65 -632.80'))).toBe(
      false,
    );
    expect(pageHasNothingToRead(page('Total 1 234,56'))).toBe(false);
  });

  it('a scan (no text layer, a full-page image) is read', () => {
    expect(pageHasNothingToRead(page('', [PAGE]))).toBe(false);
  });

  it('a cheque-image page with a short header is read', () => {
    expect(
      pageHasNothingToRead(
        page('Business Banking statement 9533-2318 QUEBEC INC.', [
          [80, 180, 860, 390],
        ]),
      ),
    ).toBe(false);
  });

  it('dates, years and $100,000 are not amounts', () => {
    expect(
      pageHasNothingToRead(page('by April 30, 2026 up to $100,000 per beneficiary')),
    ).toBe(true);
  });
});

describe('pagesToSkip', () => {
  it('never skips page 1', () => {
    expect([...pagesToSkip([page(''), page(''), page('Total 5.00')])]).toEqual([1]);
  });
});
