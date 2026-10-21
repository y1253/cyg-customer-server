import {
  accountStatusMessage,
  financialReportMessage,
  nothingOpen,
  statusLines,
  type AccountStatus,
} from './schedule-messages.util';

const none: AccountStatus = {
  unmatchedFiles: 0,
  newDocuments: 0,
  uncategorized: 0,
  unrecognizedNames: 0,
  statementsToReview: 0,
  statementsWaiting: 0,
};

describe('scheduled messages (step11b)', () => {
  it('sends no overview when nothing is open', () => {
    expect(nothingOpen(none)).toBe(true);
    expect(nothingOpen({ ...none, uncategorized: 1 })).toBe(false);
  });

  it('lists what is open, most actionable first, with correct plurals', () => {
    expect(
      statusLines({
        ...none,
        unmatchedFiles: 20,
        uncategorized: 1,
        statementsToReview: 2,
      }),
    ).toEqual([
      "2 statements we couldn't read or that need a look",
      '20 attachments (receipts, cheques…) not matched to a transaction yet',
      '1 transaction is still Uncategorized',
    ]);
  });

  it('writes a text and an email for the weekly overview', () => {
    const input = {
      firstName: 'Dana',
      book: 'ABC Inc',
      status: { ...none, unmatchedFiles: 20 },
      link: 'https://cygfinance.com/dashboard/businesses/3',
    };
    const sms = accountStatusMessage({ ...input, sms: true });
    expect(sms.text).toContain(
      'Hi Dana, your weekly account status (ABC Inc):',
    );
    expect(sms.text).toContain('• 20 attachments');
    expect(sms.text).toContain(input.link);
    const email = accountStatusMessage({ ...input, sms: false });
    expect(email.subject).toBe(
      'Your account status — 1 item to review (ABC Inc)',
    );
    expect(email.html).toContain('<li>20 attachments');
  });

  it('escapes a business name in the email html', () => {
    const email = accountStatusMessage({
      firstName: 'Dana',
      book: 'Smith & <Sons>',
      status: { ...none, uncategorized: 3 },
      link: 'https://x',
      sms: false,
    });
    expect(email.html).toContain('Smith &amp; &lt;Sons&gt;');
  });

  it('summarises the monthly report and warns while rows are Uncategorized', () => {
    const sms = financialReportMessage({
      firstName: 'Dana',
      book: 'ABC Inc',
      period: 'September 2026',
      income: 1200,
      expenses: 1500.5,
      net: -300.5,
      uncategorized: 4,
      link: 'https://cygfinance.com/api/f/x',
      sms: true,
    });
    expect(sms.text).toContain('net loss $300.50');
    expect(sms.text).toContain('4 transactions are still Uncategorized');
    expect(sms.text).toContain('Full report: https://cygfinance.com/api/f/x');
  });
});
