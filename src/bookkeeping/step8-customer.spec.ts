import { failedChecks } from './bookkeeping.service';
import { withCustomerNote } from './statement-processor.service';

describe('withCustomerNote (step8)', () => {
  it('adds what the customer said about this statement after the learned rules', () => {
    const out = withCustomerNote(
      '\n\nHouse rules…\n1. x',
      ' Page 3 is a different account ',
    );
    expect(out.startsWith('\n\nHouse rules…')).toBe(true);
    expect(out).toContain('\n\nThe customer says about THIS statement');
    expect(out.endsWith('Page 3 is a different account')).toBe(true);
  });

  it('leaves the rules alone with no note', () => {
    expect(withCustomerNote('rules', null)).toBe('rules');
    expect(withCustomerNote('rules', '   ')).toBe('rules');
  });
});

describe('failedChecks (step8)', () => {
  it('returns the words of the failed checks, not the passed or skipped ones', () => {
    expect(
      failedChecks([
        { ok: true, text: 'Deposits $10.00 ✓' },
        {
          ok: false,
          skipped: null,
          text: 'Withdrawals: statement $5.00, read $4.00 (off by $1.00)',
        },
        {
          ok: false,
          skipped: 'no total printed',
          text: 'Balance: not compared',
        },
      ]),
    ).toEqual(['Withdrawals: statement $5.00, read $4.00 (off by $1.00)']);
  });

  it('is empty for nothing stored', () => {
    expect(failedChecks(null)).toEqual([]);
    expect(failedChecks({})).toEqual([]);
  });
});
