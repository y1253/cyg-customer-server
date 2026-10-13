/**
 * A phone number as a person typed it -> E.164, for MATCHING.
 *
 * ── Why this exists on the server at all ─────────────────────────────────────
 * Company phones (`ContactInfo.privatePhone`, `Accountant.phone`, and a `Contact`'s own
 * `phone`) are free `String?` columns stored exactly as typed. SignalWire's `counterparty`
 * is strict E.164. Matching an inbound caller against a saved contact therefore needs BOTH
 * sides normalised, and only one side was.
 *
 * A copy of the internal API's `toE164` (`internal/server/src/phone/phone-number.util.ts`), which ports `client/src/lib/phone.ts`, and that is on purpose:
 * the algorithm there is already right, and a second implementation that drifts would mean
 * a contact matching in the picker and not on the incoming call -- the least debuggable
 * shape this bug could take. If one changes, change both; `phone-number.util.spec.ts`
 * mirrors the client's cases so the two stay honest.
 */

/**
 * `(438) 256-1210`, `438-256-1210`, `4382561210`, `14382561210` and an already well-formed
 * `+14382561210` all resolve. Anything else needs its country code spelled out with a `+`,
 * because guessing one would silently match the wrong country's number.
 *
 * Returns null rather than throwing: a number that cannot be normalised is still a valid
 * thing to store and display, it simply can never match a call.
 */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  // A bare 10-digit number is NANP; 11 digits starting with 1 is the same number
  // written out.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
