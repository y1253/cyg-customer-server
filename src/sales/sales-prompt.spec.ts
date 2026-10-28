import { JwtService } from '@nestjs/jwt';
import { salesTexts } from '../assistant/instructions.util';
import { BUILTIN_INSTRUCTIONS } from '../assistant/instructions-builtin';
import { VoiceCallsService } from '../voice/voice-calls.service';
import {
  DailyCounter,
  SALES_PITCH_DEFAULT,
  SIGNUP_LINE,
  priceWords,
  salesPrompt,
  withSignupLine,
} from './sales-prompt';

const base = {
  today: '2026-10-25',
  pricing: { generatePriceCents: 2500, currency: 'cad' },
  reach: {
    numbers: ['+14385550000'],
    whatsapp: ['+14385550000'],
    voice: true,
    email: 'ai@cygfinance.com',
  },
  offered: false,
};

describe('salesPrompt (step12f)', () => {
  it('pitches the firm with the live price and reach, and never offers to follow up', () => {
    const p = salesPrompt({ ...base, channel: 'SMS' });
    expect(p).toContain('does NOT have a CYG Finance account');
    expect(p).toContain('$25.00 CAD');
    expect(p).toContain('text, WhatsApp or call +14385550000');
    expect(p).toContain('never promise to call or text them later');
    expect(p).toContain(SALES_PITCH_DEFAULT);
    expect(p).toContain('do not write it yourself');
  });

  it('a call speaks the language and texts the sign-up only when asked', () => {
    const p = salesPrompt({
      ...base,
      channel: 'CALL',
      language: 'French',
      maxMinutes: 10,
    });
    expect(p).toContain('THIS IS A PHONE CALL');
    expect(p).toContain('Speak French by default');
    expect(p).toContain('ends after 10 minutes');
    expect(p).toContain('it texts them once');
    expect(p).toContain('text_caller');
    expect(p).toContain('[The caller just texted you');
  });

  it('free pricing never quotes a price', () => {
    const p = salesPrompt({
      ...base,
      channel: 'WHATSAPP',
      pricing: { generatePriceCents: 0, currency: 'cad' },
    });
    expect(p).toContain('free right now');
    expect(p).not.toContain('$');
  });

  it('an offer already sent → remind to reply YES', () => {
    expect(salesPrompt({ ...base, channel: 'SMS', offered: true })).toContain(
      'already sent',
    );
  });

  it("the admin's pitch replaces the default, extras are appended", () => {
    const p = salesPrompt(
      { ...base, channel: 'SMS' },
      { pitch: '- Always mention the free trial.', extras: '\n\nEXTRA' },
    );
    expect(p).toContain('- Always mention the free trial.');
    expect(p).not.toContain(SALES_PITCH_DEFAULT);
    expect(p.endsWith('EXTRA')).toBe(true);
  });

  it('priceWords', () => {
    expect(priceWords({ generatePriceCents: 1999, currency: 'usd' })).toBe(
      '$19.99 USD',
    );
  });
});

describe('withSignupLine', () => {
  it('adds the YES line once, only when offered', () => {
    expect(withSignupLine('Great!', false)).toBe('Great!');
    expect(withSignupLine('Great!', true)).toBe(`Great!\n\n${SIGNUP_LINE}`);
    expect(withSignupLine('Just reply YES to this.', true)).toBe(
      'Just reply YES to this.',
    );
  });
});

describe('DailyCounter', () => {
  it('counts per key per UTC day', () => {
    const c = new DailyCounter();
    const d1 = new Date('2026-10-25T10:00:00Z');
    expect(c.take('a', 2, d1)).toBe(true);
    expect(c.take('a', 2, d1)).toBe(true);
    expect(c.take('a', 2, d1)).toBe(false);
    expect(c.take('b', 2, d1)).toBe(true);
    expect(c.take('a', 2, new Date('2026-10-26T00:00:01Z'))).toBe(true);
  });
});

describe('SALES instructions', () => {
  const row = (key: string, text: string, sortOrder = 10) => ({
    id: sortOrder,
    key,
    text,
    target: 'SALES',
    isStrong: false,
    sortOrder,
  });

  it('the pitch row is the pitch; the others are extras', () => {
    const t = salesTexts([
      row('sales.pitch', 'PITCH'),
      row('extra.trial', 'Mention the trial', 200),
      { ...row('extra.other', 'Not sales', 201), target: 'ASSISTANT' },
    ]);
    expect(t.pitch).toBe('PITCH');
    expect(t.extras).toContain('- Mention the trial');
    expect(t.extras).not.toContain('PITCH');
    expect(t.extras).not.toContain('Not sales');
  });

  it('the pitch is seeded as a SALES built-in', () => {
    const b = BUILTIN_INSTRUCTIONS.find((i) => i.key === 'sales.pitch');
    expect(b).toMatchObject({ target: 'SALES', text: SALES_PITCH_DEFAULT });
  });
});

describe('VoiceCallsService.verify — PROSPECT calls', () => {
  const secret = 'test-secret';
  const jwt = new JwtService({ secret });
  const svc = Object.create(VoiceCallsService.prototype) as VoiceCallsService;
  (svc as unknown as { jwt: JwtService }).jwt = jwt;

  it('accepts an inbound PROSPECT token with no customer (sub 0)', () => {
    const token = jwt.sign({
      typ: 'voice-call',
      peer: '+15145550010',
      to: '+14385550000',
      dir: 'INBOUND',
      purpose: 'PROSPECT',
    });
    expect(svc.verify(token)).toMatchObject({ sub: 0, purpose: 'PROSPECT' });
  });

  it('refuses an OUTBOUND prospect token, and a customer token without sub', () => {
    expect(
      svc.verify(
        jwt.sign({
          typ: 'voice-call',
          peer: '+15145550010',
          dir: 'OUTBOUND',
          purpose: 'PROSPECT',
        }),
      ),
    ).toBeNull();
    expect(
      svc.verify(
        jwt.sign({ typ: 'voice-call', peer: '+15145550010', dir: 'INBOUND' }),
      ),
    ).toBeNull();
  });
});
