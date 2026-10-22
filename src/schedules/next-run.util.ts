/**
 * When a book's scheduled message next goes out (step11b) — pure, so the calendar rules are
 * tested without a clock or a database.
 *
 * Times are WALL-CLOCK in the schedule's own time zone ("Mondays at 14:00 in Toronto"), so
 * daylight saving is the time zone database's problem, never ours: a local date + time is
 * turned into an instant by asking `Intl` what the zone's offset is at that moment.
 */

/** DAILY (step12) is only for the schedules the AI makes; the two built-ins stay weekly/monthly. */
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export const FREQUENCIES: readonly Frequency[] = ['WEEKLY', 'MONTHLY'];
export const AI_FREQUENCIES: readonly Frequency[] = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
];

export interface ScheduleRule {
  frequency: Frequency;
  /** WEEKLY: 0 = Sunday … 6 = Saturday. */
  weekday: number | null;
  /** MONTHLY: 1–28, or 0 = the last day of the month. */
  monthDay: number | null;
  /** "HH:mm", 24 h. */
  time: string;
  /** IANA zone, e.g. "America/Toronto". */
  timezone: string;
}

export const DEFAULT_TIMEZONE = 'America/Toronto';

/** A zone `Intl` knows, else the default (a typo must not stop every schedule). */
export function safeZone(tz: string | null | undefined): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz ?? DEFAULT_TIMEZONE });
    return tz || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** "14:05" → [14, 5]; anything else → null. */
export function parseTime(time: string): [number, number] | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time?.trim() ?? '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** The wall-clock parts of `at` in `tz`. */
export function wallClock(
  at: Date,
  tz: string,
): { y: number; m: number; d: number; h: number; min: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const DOW: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    // Some ICU builds say "24" for midnight.
    h: Number(get('hour')) % 24,
    min: Number(get('minute')),
    dow: DOW[get('weekday')] ?? 0,
  };
}

/** The instant a local date + time in `tz` happens. */
export function zonedInstant(
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
  tz: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  // The zone's offset at the guess, then once more at the corrected instant (DST edges).
  let at = guess;
  for (let i = 0; i < 2; i++) {
    const w = wallClock(new Date(at), tz);
    const shown = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
    at += guess - shown;
  }
  return new Date(at);
}

const daysIn = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The first time the rule fires strictly after `after`, or null for a broken rule. */
export function nextRun(rule: ScheduleRule, after: Date): Date | null {
  const hm = parseTime(rule.time);
  if (!hm) return null;
  const tz = safeZone(rule.timezone);
  const start = wallClock(after, tz);
  // Walk local calendar days from today: at most ~2 months for a monthly rule.
  for (let i = 0; i <= 70; i++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    if (rule.frequency === 'DAILY') {
      // every day matches
    } else if (rule.frequency === 'WEEKLY') {
      if (rule.weekday === null || day.getUTCDay() !== rule.weekday) continue;
    } else {
      const want = rule.monthDay ?? 1;
      const target = want === 0 ? daysIn(y, m) : Math.min(want, 28);
      if (d !== target) continue;
    }
    const at = zonedInstant(y, m, d, hm[0], hm[1], tz);
    if (at.getTime() > after.getTime()) return at;
  }
  return null;
}

/**
 * The calendar month before the one `at` falls in, in `tz` — what the monthly financial
 * report covers ("2026-09-01".."2026-09-30").
 */
export function previousMonth(
  at: Date,
  tz: string,
): { from: string; to: string; label: string } {
  const w = wallClock(at, safeZone(tz));
  const y = w.m === 1 ? w.y - 1 : w.y;
  const m = w.m === 1 ? 12 : w.m - 1;
  const mm = String(m).padStart(2, '0');
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(daysIn(y, m)).padStart(2, '0')}`,
    label,
  };
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** "Every Monday at 2:00 PM" / "On the last day of every month at 9:00 AM". */
export function describeRule(rule: ScheduleRule): string {
  const hm = parseTime(rule.time);
  const time = hm
    ? new Date(Date.UTC(2000, 0, 1, hm[0], hm[1])).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
      })
    : rule.time;
  if (rule.frequency === 'DAILY') return `Every day at ${time}`;
  if (rule.frequency === 'WEEKLY') {
    return `Every ${WEEKDAY_NAMES[rule.weekday ?? 1]} at ${time}`;
  }
  const d = rule.monthDay ?? 1;
  const nth =
    d === 0
      ? 'last day'
      : `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`;
  return `On the ${nth} of every month at ${time}`;
}
