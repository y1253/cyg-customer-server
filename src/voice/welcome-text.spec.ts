import { welcomeText } from './voice.controller';
import { parseNameFields } from '../bookkeeping/tax.service';

describe('welcomeText (step2 2026-11-09)', () => {
  it('greets by first name and lists every way to reach the AI', () => {
    expect(welcomeText('Sarah Cohen', true, true)).toMatch(
      /^Hi Sarah, .*Save this number: text, WhatsApp or call me any time/,
    );
  });
  it('says only what the number takes', () => {
    const t = welcomeText('', false, false);
    expect(t).toMatch(/^Hi, /);
    expect(t).toContain('Save this number: text me any time');
    expect(t).not.toMatch(/WhatsApp|call me/);
  });
  it('always tells how to stop texts', () => {
    expect(welcomeText('A', false, true)).toContain('Reply STOP');
  });
});

describe('parseNameFields (step2 2026-11-09)', () => {
  it('keeps valid fields and drops empty or broken ones', () => {
    expect(
      parseNameFields([
        { kind: 'PHONE', label: 'Mobile', value: '+15145551234' },
        { kind: 'WEIRD', label: 'x', value: 'kept as text' },
        { kind: 'EMAIL', label: '', value: '' },
        null,
        'nope',
      ]),
    ).toEqual([
      { kind: 'PHONE', label: 'Mobile', value: '+15145551234' },
      { kind: 'TEXT', label: 'x', value: 'kept as text' },
    ]);
  });
  it('reads anything that is not a list as no fields', () => {
    expect(parseNameFields(null)).toEqual([]);
    expect(parseNameFields({ kind: 'PHONE' })).toEqual([]);
  });
});
