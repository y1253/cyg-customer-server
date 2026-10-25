/**
 * step12d: the pure rules of text / call cost tracking — segments, list-price costs, and
 * the sanity check on prices read off a provider's pricing page. Mirrored in the internal
 * server (`phone/comm-usage.util.ts`); keep the two the same.
 */

export type CommChannel = 'SMS' | 'WHATSAPP';
export type CommDirection = 'IN' | 'OUT';

export type CommPurpose =
  | 'ASSISTANT_REPLY'
  | 'SEND_MESSAGE'
  | 'SEND_TEXT'
  | 'TEXT_PERSON'
  | 'LOGIN_CODE'
  | 'SCHEDULE'
  | 'AI_SCHEDULE'
  | 'SIGNUP_OFFER'
  | 'CONTACT_RELAY'
  | 'INTAKE'
  | 'STRONG_AI'
  | 'FEATURE_DONE'
  | 'BANK_ALERT'
  | 'OTHER';

/** A provider's list prices in USD (null = unknown). */
export interface CommPrices {
  smsOutPerSegment: number | null;
  smsInPerSegment: number | null;
  mmsOut: number | null;
  mmsIn: number | null;
  voiceOutPerMin: number | null;
  voiceInPerMin: number | null;
  recordingPerMin: number | null;
  whatsappOut: number | null;
  whatsappIn: number | null;
}

export const PRICE_FIELDS: ReadonlyArray<keyof CommPrices> = [
  'smsOutPerSegment',
  'smsInPerSegment',
  'mmsOut',
  'mmsIn',
  'voiceOutPerMin',
  'voiceInPerMin',
  'recordingPerMin',
  'whatsappOut',
  'whatsappIn',
];

/** A provider row's Decimal prices as numbers. */
export function pricesOf(row: Record<string, unknown>): CommPrices {
  const out = {} as CommPrices;
  for (const k of PRICE_FIELDS) {
    const v = row[k];
    out[k] = v === null || v === undefined ? null : Number(v);
  }
  return out;
}

const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';

/**
 * How many SMS segments a text is billed as: GSM-7 = 160 characters (153 per part once
 * split; `^{}\[~]|€` count twice), anything else UCS-2 = 70 (67 per part, by UTF-16 unit).
 */
export function segmentsOf(body: string): number {
  if (!body) return 1;
  let gsm = true;
  let units = 0;
  for (const ch of body) {
    if (GSM7.includes(ch)) units += 1;
    else if (GSM7_EXT.includes(ch)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) return units <= 160 ? 1 : Math.ceil(units / 153);
  const len = body.length; // UTF-16 code units
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

/** Every started minute is billed. */
export function billedMinutes(durationSec: number): number {
  return durationSec > 0 ? Math.ceil(durationSec / 60) : 0;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** One message's list-price cost, or null when the provider has no price for it. */
export function messageCost(
  p: CommPrices,
  m: {
    channel: CommChannel;
    direction: CommDirection;
    segments: number;
    media: number;
  },
): number | null {
  if (m.channel === 'WHATSAPP') {
    const price = m.direction === 'OUT' ? p.whatsappOut : p.whatsappIn;
    return price === null ? null : round6(price);
  }
  if (m.media > 0) {
    const price = m.direction === 'OUT' ? p.mmsOut : p.mmsIn;
    return price === null ? null : round6(price);
  }
  const price = m.direction === 'OUT' ? p.smsOutPerSegment : p.smsInPerSegment;
  return price === null ? null : round6(price * Math.max(1, m.segments));
}

/** One call's list-price cost (minutes + recording), or null when the minute price is unknown. */
export function callCost(
  p: CommPrices,
  c: { direction: CommDirection; durationSec: number; recordingSec: number },
): number | null {
  const perMin = c.direction === 'OUT' ? p.voiceOutPerMin : p.voiceInPerMin;
  if (perMin === null) return null;
  const minutes = billedMinutes(c.durationSec);
  const recording = billedMinutes(c.recordingSec) * (p.recordingPerMin ?? 0);
  return round6(minutes * perMin + recording);
}

/** A SignalWire `price` ("-0.00415", null while pending) as a positive cost. */
export function billedPrice(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? round6(Math.abs(n)) : null;
}

/**
 * Checks the prices the AI read off a pricing page before they are saved: each must be a
 * number between $0 and $1, and — when there was a price — at most 3× and at least ⅓ of it
 * (a misread decimal place is the usual mistake). Fields the page did not give keep the old
 * value. Answers the prices to save, or the reason they were refused.
 */
export function checkPagePrices(
  read: Partial<Record<keyof CommPrices, number | null>>,
  current: CommPrices,
): { ok: true; prices: CommPrices } | { ok: false; reason: string } {
  const out: CommPrices = { ...current };
  let found = 0;
  for (const k of PRICE_FIELDS) {
    const v = read[k];
    if (v === null || v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
      return {
        ok: false,
        reason: `${k} = ${String(v)} is not a believable price`,
      };
    }
    const old = current[k];
    if (old !== null && old > 0 && (v > old * 3 || v < old / 3)) {
      return {
        ok: false,
        reason: `${k} read as ${v}, too far from the current ${old}`,
      };
    }
    out[k] = round6(v);
    found++;
  }
  if (!found) return { ok: false, reason: 'no price found on the page' };
  return { ok: true, prices: out };
}

export function samePrices(a: CommPrices, b: CommPrices): boolean {
  return PRICE_FIELDS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/** A pricing page's HTML as plain text (scripts, styles and tags gone), at most `max` chars. */
export function pageText(html: string, max = 60_000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#36;|&dollar;/g, '$')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
