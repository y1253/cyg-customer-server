import { toE164 } from './phone-number.util';

/**
 * These mirror `client/src/lib/phone.ts`'s cases deliberately. The two copies exist
 * because the client validates before submitting and the server normalises before
 * storing; a drift between them means a contact that matches in one place and not the
 * other, which presents as "the name shows sometimes".
 */
describe('toE164', () => {
  it('passes a well-formed E.164 number through unchanged', () => {
    expect(toE164('+14382561210')).toBe('+14382561210');
    expect(toE164('  +14382561210  ')).toBe('+14382561210');
    // Not NANP, and not ours to reformat.
    expect(toE164('+442071838750')).toBe('+442071838750');
  });

  it('accepts the shapes a person actually types', () => {
    for (const written of [
      '(438) 256-1210',
      '438-256-1210',
      '438.256.1210',
      '4382561210',
      '14382561210',
      '1 (438) 256-1210',
    ]) {
      expect(toE164(written)).toBe('+14382561210');
    }
  });

  it('refuses to guess a country code', () => {
    // Seven digits is a real local number somewhere; assuming +1 would match a stranger.
    expect(toE164('2561210')).toBeNull();
    // 11 digits NOT starting with 1 is not a written-out NANP number.
    expect(toE164('44207183875')).toBeNull();
  });

  /**
   * A KNOWN limitation, pinned rather than fixed: ten digits is read as NANP whatever
   * country it came from, so a London number written without its `+44` becomes a
   * Pennsylvania one. Fixing it needs the company's country, which the client copy of
   * this function does not have -- and the two must not diverge. The consequence is
   * bounded: a wrongly-normalised contact simply never matches an inbound call.
   */
  it('reads any bare 10-digit number as NANP, including a foreign one', () => {
    expect(toE164('20 7183 8750')).toBe('+12071838750');
  });

  it('returns null for absent or unusable input rather than throwing', () => {
    expect(toE164(null)).toBeNull();
    expect(toE164(undefined)).toBeNull();
    expect(toE164('')).toBeNull();
    expect(toE164('   ')).toBeNull();
    expect(toE164('ask reception')).toBeNull();
    // A leading zero is invalid in E.164 even with the +.
    expect(toE164('+04382561210')).toBeNull();
  });
});
