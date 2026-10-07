const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * The short name a customer sees for a statement on every ledger row and in the exports:
 * "Chase 4362 · Sep 2026". When the period does not sit inside one calendar month it is
 * the range instead: "Sep 15 – Oct 14, 2026" / "Dec 15, 2026 – Jan 14, 2027".
 * Falls back to the bank name, then the filename, for whatever the statement did not show.
 * Dates are compared in UTC — they are stored as date-only UTC midnights.
 */
export function statementLabel(s: {
  accountName: string | null;
  bankName?: string | null;
  filename: string;
  periodStart: Date | null;
  periodEnd: Date | null;
}): string {
  const name = s.accountName ?? s.bankName ?? s.filename;
  const a = s.periodStart;
  const b = s.periodEnd ?? s.periodStart;
  if (!a || !b) return name;

  const mon = (d: Date) => MONTHS[d.getUTCMonth()];
  const sameMonth =
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth();
  if (sameMonth) return `${name} · ${mon(a)} ${a.getUTCFullYear()}`;
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const range = sameYear
    ? `${mon(a)} ${a.getUTCDate()} – ${mon(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`
    : `${mon(a)} ${a.getUTCDate()}, ${a.getUTCFullYear()} – ${mon(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  return `${name} · ${range}`;
}
