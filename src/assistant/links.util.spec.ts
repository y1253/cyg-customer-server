import {
  addLink,
  fillLinks,
  FRESH_LINK_HINT,
  type LinkBook,
} from './links.util';

const REAL =
  'https://cygfinance.com/api/f/eyJhbGciOiJIUzI1NiJ9.eyJ0eXAiOiJmaWxlLWxpbmsifQ.abc_DEF-123';

describe('addLink', () => {
  it('numbers links and reuses the placeholder for the same URL', () => {
    const book: LinkBook = new Map();
    expect(addLink(book, REAL)).toBe('[[link:1]]');
    expect(addLink(book, `${REAL}x`)).toBe('[[link:2]]');
    expect(addLink(book, REAL)).toBe('[[link:1]]');
  });
});

describe('fillLinks', () => {
  it('puts the real URL where the placeholder is', () => {
    const book: LinkBook = new Map([['[[link:1]]', REAL]]);
    expect(fillLinks('Here it is: [[link:1]]', book)).toBe(
      `Here it is: ${REAL}`,
    );
    expect(fillLinks('Here: [[ Link : 1 ]].', book)).toBe(`Here: ${REAL}.`);
  });

  it('never sends a file link the model typed itself', () => {
    const book: LinkBook = new Map([['[[link:1]]', REAL]]);
    // One character off — what happened on 2026-10-22.
    const retyped = REAL.replace('abc', 'abd');
    expect(fillLinks(`Open ${retyped} now`, book)).toBe(
      `Open ${FRESH_LINK_HINT} now`,
    );
    // A stale link from an older message, no host.
    expect(fillLinks('see /api/f/old.token.sig', null)).toBe(
      `see ${FRESH_LINK_HINT}`,
    );
  });

  it('keeps a URL issued in this run, character for character', () => {
    const book: LinkBook = new Map([['[[link:1]]', REAL]]);
    expect(fillLinks(`Open ${REAL}`, book)).toBe(`Open ${REAL}`);
  });

  it('an unknown placeholder becomes the hint', () => {
    expect(fillLinks('Here: [[link:3]]', new Map())).toBe(
      `Here: ${FRESH_LINK_HINT}`,
    );
  });

  it('leaves other links and plain text alone', () => {
    const text = 'Sign in at https://cygfinance.com/dashboard/bookkeeping';
    expect(fillLinks(text, new Map())).toBe(text);
  });
});
