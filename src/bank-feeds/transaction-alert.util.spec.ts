import {
  ALERT_MAX_LINES,
  alertChannel,
  alertText,
  recentEnough,
  type AlertRow,
} from './transaction-alert.util';

describe('alertChannel', () => {
  const both = {
    phone: '+15145551234',
    email: 'a@b.com',
    smsConfigured: true,
  };
  it('uses the preferred contact', () => {
    expect(alertChannel({ ...both, preferred: 'EMAIL' })).toBe('EMAIL');
    expect(alertChannel({ ...both, preferred: 'SMS' })).toBe('SMS');
    expect(alertChannel({ ...both, preferred: 'WHATSAPP' })).toBe('WHATSAPP');
  });
  it('texts a "phone call" preference (no call per transaction)', () => {
    expect(alertChannel({ ...both, preferred: 'CALL' })).toBe('SMS');
  });
  it('never falls back to another channel', () => {
    expect(
      alertChannel({ ...both, preferred: 'EMAIL', email: null }),
    ).toBeNull();
    expect(
      alertChannel({ ...both, preferred: 'SMS', smsConfigured: false }),
    ).toBeNull();
    expect(
      alertChannel({ ...both, preferred: 'WHATSAPP', phone: null }),
    ).toBeNull();
  });
  it('nothing saved: a text when they have a phone, else email', () => {
    expect(alertChannel({ ...both, preferred: null })).toBe('SMS');
    expect(alertChannel({ ...both, preferred: null, phone: null })).toBe(
      'EMAIL',
    );
    expect(
      alertChannel({ ...both, preferred: null, smsConfigured: false }),
    ).toBe('EMAIL');
    expect(
      alertChannel({ ...both, preferred: null, phone: null, email: null }),
    ).toBeNull();
  });
});

describe('recentEnough', () => {
  it('alerts rows from the last 7 days only', () => {
    expect(recentEnough('2026-10-25', '2026-10-25')).toBe(true);
    expect(recentEnough('2026-10-18', '2026-10-25')).toBe(true);
    expect(recentEnough('2026-10-17', '2026-10-25')).toBe(false);
  });
});

describe('alertText', () => {
  const row = (p: Partial<AlertRow>): AlertRow => ({
    account: 'TD Canada Trust 6074',
    date: '2026-10-24',
    label: 'Tim Hortons',
    amount: -4.5,
    category: 'Meals and Entertainment',
    ...p,
  });
  it('one transaction', () => {
    expect(alertText({ book: null, rows: [row({})] })).toBe(
      'New transaction in TD Canada Trust 6074:\n' +
        '• Oct 24 · Tim Hortons · −$4.50 → Meals and Entertainment\n' +
        'Reply to change the category.',
    );
  });
  it('groups by account, oldest first, money in with a plus, names the book', () => {
    const text = alertText({
      book: 'Company1',
      rows: [
        row({
          date: '2026-10-24',
          label: 'Payroll',
          amount: 1200,
          category: 'Sales',
        }),
        row({ date: '2026-10-23' }),
        row({
          account: 'BMO 5090',
          label: 'Fee',
          amount: -1,
          category: 'Bank Charges',
        }),
      ],
    });
    expect(text.split('\n')).toEqual([
      'New transactions in BMO 5090 (Company1):',
      '• Oct 24 · Fee · −$1.00 → Bank Charges',
      'New transactions in TD Canada Trust 6074 (Company1):',
      '• Oct 23 · Tim Hortons · −$4.50 → Meals and Entertainment',
      '• Oct 24 · Payroll · +$1,200.00 → Sales',
      'Reply to change a category.',
    ]);
  });
  it('asks what an uncategorized one was', () => {
    expect(
      alertText({ book: null, rows: [row({ category: 'Uncategorized' })] }),
    ).toContain('→ Uncategorized (reply with what it was)');
  });
  it(`lists at most ${ALERT_MAX_LINES} and counts the rest`, () => {
    const rows = Array.from({ length: 13 }, (_, i) =>
      row({ date: `2026-10-${String(10 + i).padStart(2, '0')}` }),
    );
    const lines = alertText({ book: null, rows }).split('\n');
    expect(lines.filter((l) => l.startsWith('•'))).toHaveLength(
      ALERT_MAX_LINES,
    );
    expect(lines).toContain('…and 3 more on cygfinance.com');
  });
});
