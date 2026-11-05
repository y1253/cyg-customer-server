import { explainPlaidError, plaidErrorDetail } from './plaid-error.util';

describe('explainPlaidError', () => {
  it('says what happened and what to do for a known code', () => {
    const text = explainPlaidError('ITEM_LOGIN_REQUIRED');
    expect(text).toMatch(/sign in again/i);
    expect(text).not.toMatch(/ITEM_LOGIN_REQUIRED/);
  });

  it('tells the customer a bank outage is not their problem', () => {
    expect(explainPlaidError('INSTITUTION_DOWN')).toMatch(/nothing is wrong/i);
  });

  it('falls back to a plain sentence for an unknown or missing code', () => {
    expect(explainPlaidError('SOMETHING_NEW')).toMatch(/stopped working/);
    expect(explainPlaidError(null)).toBe(explainPlaidError(undefined));
  });
});

describe('plaidErrorDetail', () => {
  it('keeps the raw code and message', () => {
    expect(
      plaidErrorDetail('INVALID_MFA', 'the provided MFA was invalid'),
    ).toBe('INVALID_MFA: the provided MFA was invalid');
  });

  it('is null when there is nothing to keep, and is capped', () => {
    expect(plaidErrorDetail(null, '')).toBeNull();
    expect(plaidErrorDetail('X', 'y'.repeat(5000))).toHaveLength(2000);
  });
});
