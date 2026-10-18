import {
  CODE_MAIL_DAY_MS,
  CODE_MAIL_GAP_MS,
  CODE_MAIL_PER_ADDRESS,
  CodeMailLimiter,
  maskEmail,
} from './code-mail-limiter';

function limiter(perHour = 30) {
  let t = 1_000_000;
  const l = new CodeMailLimiter(perHour, () => t);
  const send = (email: string) => {
    const v = l.check(email);
    if (v === 'ok') l.record(email);
    return v;
  };
  return { send, advance: (ms: number) => (t += ms) };
}

describe('CodeMailLimiter', () => {
  it('allows one code a minute to the same address', () => {
    const { send, advance } = limiter();
    expect(send('a@x.com')).toBe('ok');
    expect(send('a@x.com')).toBe('address');
    advance(CODE_MAIL_GAP_MS);
    expect(send('a@x.com')).toBe('ok');
  });

  it('caps an address per day, then frees it a day later', () => {
    const { send, advance } = limiter();
    for (let i = 0; i < CODE_MAIL_PER_ADDRESS; i++) {
      expect(send('a@x.com')).toBe('ok');
      advance(CODE_MAIL_GAP_MS);
    }
    expect(send('a@x.com')).toBe('address');
    expect(send('b@x.com')).toBe('ok');
    advance(CODE_MAIL_DAY_MS);
    expect(send('a@x.com')).toBe('ok');
  });

  it('caps the whole server per hour, whatever the addresses', () => {
    const { send, advance } = limiter(3);
    expect(send('a@x.com')).toBe('ok');
    expect(send('b@x.com')).toBe('ok');
    expect(send('c@x.com')).toBe('ok');
    expect(send('d@x.com')).toBe('global');
    advance(60 * 60_000);
    expect(send('d@x.com')).toBe('ok');
  });

  it('a refused check counts nothing', () => {
    const { send } = limiter(1);
    expect(send('a@x.com')).toBe('ok');
    expect(send('b@x.com')).toBe('global');
    expect(send('b@x.com')).toBe('global');
  });
});

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('chaim@cygfinance.com')).toBe('c***@cygfinance.com');
    expect(maskEmail('nonsense')).toBe('***');
  });
});
