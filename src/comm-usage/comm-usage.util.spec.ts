import {
  billedMinutes,
  billedPrice,
  callCost,
  checkPagePrices,
  messageCost,
  pageText,
  segmentsOf,
  type CommPrices,
} from './comm-usage.util';

const NONE: CommPrices = {
  smsOutPerSegment: null,
  smsInPerSegment: null,
  mmsOut: null,
  mmsIn: null,
  voiceOutPerMin: null,
  voiceInPerMin: null,
  recordingPerMin: null,
  whatsappOut: null,
  whatsappIn: null,
};
const P: CommPrices = {
  ...NONE,
  smsOutPerSegment: 0.004,
  smsInPerSegment: 0.003,
  mmsOut: 0.015,
  voiceOutPerMin: 0.01,
  voiceInPerMin: 0.006,
  recordingPerMin: 0.002,
  whatsappOut: 0,
};

describe('segmentsOf', () => {
  it('counts GSM-7 texts by 160, then 153 per part', () => {
    expect(segmentsOf('a'.repeat(160))).toBe(1);
    expect(segmentsOf('a'.repeat(161))).toBe(2);
    expect(segmentsOf('a'.repeat(306))).toBe(2);
    expect(segmentsOf('a'.repeat(307))).toBe(3);
  });

  it('counts the extension characters twice', () => {
    expect(segmentsOf('€'.repeat(80))).toBe(1);
    expect(segmentsOf('€'.repeat(81))).toBe(2);
  });

  it('counts anything else as UCS-2, 70 then 67', () => {
    expect(segmentsOf('é'.repeat(100))).toBe(1); // é is GSM-7
    expect(segmentsOf('ש'.repeat(70))).toBe(1);
    expect(segmentsOf('ש'.repeat(71))).toBe(2);
    expect(segmentsOf('Hi 😀')).toBe(1);
  });
});

describe('costs', () => {
  it('prices an SMS per segment and an MMS flat', () => {
    expect(
      messageCost(P, {
        channel: 'SMS',
        direction: 'OUT',
        segments: 3,
        media: 0,
      }),
    ).toBe(0.012);
    expect(
      messageCost(P, {
        channel: 'SMS',
        direction: 'OUT',
        segments: 3,
        media: 1,
      }),
    ).toBe(0.015);
  });

  it('is null when the price is unknown', () => {
    expect(
      messageCost(P, {
        channel: 'SMS',
        direction: 'IN',
        segments: 1,
        media: 2,
      }),
    ).toBeNull();
    expect(
      callCost(NONE, { direction: 'IN', durationSec: 60, recordingSec: 0 }),
    ).toBeNull();
  });

  it('prices WhatsApp per message', () => {
    expect(
      messageCost(P, {
        channel: 'WHATSAPP',
        direction: 'OUT',
        segments: 4,
        media: 0,
      }),
    ).toBe(0);
  });

  it('bills every started minute, recording included', () => {
    expect(billedMinutes(0)).toBe(0);
    expect(billedMinutes(61)).toBe(2);
    expect(
      callCost(P, { direction: 'IN', durationSec: 61, recordingSec: 61 }),
    ).toBe(0.016);
  });

  it('reads SignalWire prices as positive costs', () => {
    expect(billedPrice('-0.00415')).toBe(0.00415);
    expect(billedPrice(null)).toBeNull();
    expect(billedPrice('')).toBeNull();
  });
});

describe('checkPagePrices', () => {
  it('takes believable prices and keeps the ones not read', () => {
    const r = checkPagePrices({ smsOutPerSegment: 0.005 }, P);
    expect(r.ok && r.prices.smsOutPerSegment).toBe(0.005);
    expect(r.ok && r.prices.voiceInPerMin).toBe(0.006);
  });

  it('refuses a misread decimal place', () => {
    expect(checkPagePrices({ smsOutPerSegment: 0.04 }, P).ok).toBe(false);
    expect(checkPagePrices({ smsOutPerSegment: 4.15 }, NONE).ok).toBe(false);
  });

  it('refuses a page with nothing on it', () => {
    expect(checkPagePrices({}, P).ok).toBe(false);
  });
});

describe('pageText', () => {
  it('drops scripts and tags', () => {
    expect(pageText('<p>SMS <b>$0.004</b></p><script>x=1</script>')).toBe(
      'SMS $0.004',
    );
  });
});
