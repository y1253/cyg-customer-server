import {
  MAX_SMS_CHARS,
  asE164,
  fitBody,
  smsForm,
  waIdOf,
  whatsappTextPayload,
} from './messaging.util';

describe('messaging util (step11b)', () => {
  it('sends WhatsApp as a PLAIN message — never a quoted reply', () => {
    const p = whatsappTextPayload('+15145551234', 'Hello');
    expect(p).not.toHaveProperty('context');
    expect(p.to).toBe('15145551234');
    expect(p.text.body).toBe('Hello');
  });

  it('reads E.164 strictly', () => {
    expect(asE164('+15145551234')).toBe('+15145551234');
    expect(asE164('5145551234')).toBeNull();
    expect(asE164(null)).toBeNull();
    expect(waIdOf('+1 (514) 555-1234')).toBe('15145551234');
  });

  it('cuts an over-long text with an ellipsis', () => {
    const long = 'a'.repeat(MAX_SMS_CHARS + 10);
    const form = smsForm('+1', '+2', long);
    expect(form.Body).toHaveLength(MAX_SMS_CHARS);
    expect(form.Body.endsWith('…')).toBe(true);
    expect(fitBody('  hi  ', 10)).toBe('hi');
  });
});
