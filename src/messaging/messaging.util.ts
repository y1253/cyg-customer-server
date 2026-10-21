/**
 * Pure rules for the customer messaging module (step11b). Kept apart from the senders so
 * they are tested without a network.
 */

/** "+15145551234" → "15145551234": WhatsApp addresses a person by wa_id, digits only. */
export function waIdOf(e164: string): string {
  return e164.replace(/\D/g, '');
}

/** A phone number in E.164, else null. */
export function asE164(phone: string | null | undefined): string | null {
  const t = (phone ?? '').trim();
  return /^\+[1-9]\d{6,14}$/.test(t) ? t : null;
}

/** The longest text one SMS send carries; longer replies are cut with an ellipsis. */
export const MAX_SMS_CHARS = 1500;
/** WhatsApp's free-form text limit. */
export const MAX_WHATSAPP_CHARS = 4096;

/** Trims, and cuts a body that is over the channel's limit. */
export function fitBody(body: string, max: number): string {
  const t = body.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The JSON body of a plain WhatsApp text (Graph `/{phone_number_id}/messages`). There is NO
 * `context` — a customer reply is a regular message, never a quoted "reply to" (user's
 * decision 2026-10-21; the staff app keeps its own quoting).
 */
export function whatsappTextPayload(to: string, body: string) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: waIdOf(to),
    type: 'text',
    text: { preview_url: true, body: fitBody(body, MAX_WHATSAPP_CHARS) },
  };
}

/** The form fields of a plain SignalWire (Compatibility API) text. */
export function smsForm(from: string, to: string, body: string) {
  return { From: from, To: to, Body: fitBody(body, MAX_SMS_CHARS) };
}
