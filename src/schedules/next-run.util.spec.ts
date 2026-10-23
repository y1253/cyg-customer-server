import {
  describeRule,
  nextRun,
  parseTime,
  previousMonth,
  safeZone,
  zonedInstant,
  type ScheduleRule,
} from './next-run.util';

const TZ = 'America/Toronto';
const weekly = (weekday: number, time: string): ScheduleRule => ({
  frequency: 'WEEKLY',
  weekday,
  monthDay: null,
  time,
  timezone: TZ,
});
const monthly = (monthDay: number, time: string): ScheduleRule => ({
  frequency: 'MONTHLY',
  weekday: null,
  monthDay,
  time,
  timezone: TZ,
});

describe('nextRun (step11b schedules)', () => {
  it('fires next Monday at 14:00 Toronto time', () => {
    // Wed 2026-10-21 12:00 UTC
    const at = nextRun(weekly(1, '14:00'), new Date('2026-10-21T12:00:00Z'));
    // Mon 2026-10-26 14:00 EDT = 18:00 UTC
    expect(at?.toISOString()).toBe('2026-10-26T18:00:00.000Z');
  });

  it('fires later today when the time has not passed yet', () => {
    // Mon 2026-10-26 10:00 EDT
    const at = nextRun(weekly(1, '14:00'), new Date('2026-10-26T14:00:00Z'));
    expect(at?.toISOString()).toBe('2026-10-26T18:00:00.000Z');
  });

  it('is strictly after: the run that just fired schedules the following week', () => {
    const at = nextRun(weekly(1, '14:00'), new Date('2026-10-26T18:00:00Z'));
    expect(at?.toISOString()).toBe('2026-11-02T19:00:00.000Z'); // EST after Nov 1
  });

  it('follows daylight saving: 9:00 stays 9:00 local', () => {
    expect(zonedInstant(2026, 7, 1, 9, 0, TZ).toISOString()).toBe(
      '2026-07-01T13:00:00.000Z',
    );
    expect(zonedInstant(2026, 12, 1, 9, 0, TZ).toISOString()).toBe(
      '2026-12-01T14:00:00.000Z',
    );
  });

  it('handles the 1st and the last day of the month', () => {
    expect(
      nextRun(
        monthly(1, '09:00'),
        new Date('2026-10-21T12:00:00Z'),
      )?.toISOString(),
    ).toBe('2026-11-01T14:00:00.000Z'); // EST: DST ended that morning
    expect(
      nextRun(
        monthly(0, '09:00'),
        new Date('2027-02-03T12:00:00Z'),
      )?.toISOString(),
    ).toBe('2027-02-28T14:00:00.000Z');
  });

  it('refuses a broken time and survives a bad time zone', () => {
    expect(nextRun(weekly(1, '25:00'), new Date())).toBeNull();
    expect(parseTime('9:00')).toBeNull();
    expect(parseTime('09:30')).toEqual([9, 30]);
    expect(safeZone('Mars/Olympus')).toBe(TZ);
  });

  it('covers the previous calendar month for the monthly report', () => {
    expect(previousMonth(new Date('2026-10-01T13:00:00Z'), TZ)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      label: 'September 2026',
    });
    expect(previousMonth(new Date('2027-01-01T14:00:00Z'), TZ).from).toBe(
      '2026-12-01',
    );
  });

  it('fires daily at the next 6:00 local (step12)', () => {
    const daily: ScheduleRule = {
      frequency: 'DAILY',
      weekday: null,
      monthDay: null,
      time: '06:00',
      timezone: TZ,
    };
    // Thu 2026-10-22 09:00 EDT -> Fri 06:00 EDT = 10:00 UTC
    expect(
      nextRun(daily, new Date('2026-10-22T13:00:00Z'))?.toISOString(),
    ).toBe('2026-10-23T10:00:00.000Z');
    // 05:00 EDT -> same day 06:00
    expect(
      nextRun(daily, new Date('2026-10-22T09:00:00Z'))?.toISOString(),
    ).toBe('2026-10-22T10:00:00.000Z');
    expect(describeRule(daily)).toBe('Every day at 6:00 AM');
  });

  it('fires a ONCE rule on its day only, never again (step12b)', () => {
    const once: ScheduleRule = {
      frequency: 'ONCE',
      weekday: null,
      monthDay: null,
      time: '15:00',
      timezone: TZ,
      date: '2026-10-28',
    };
    // Wed 2026-10-28 15:00 EDT = 19:00 UTC
    expect(nextRun(once, new Date('2026-10-22T13:00:00Z'))?.toISOString()).toBe(
      '2026-10-28T19:00:00.000Z',
    );
    expect(nextRun(once, new Date('2026-10-28T19:00:00Z'))).toBeNull();
    expect(nextRun({ ...once, date: '2026-02-30' }, new Date(0))).toBeNull();
    expect(nextRun({ ...once, date: null }, new Date(0))).toBeNull();
    expect(describeRule(once)).toBe('Once, on Wed, Oct 28, 2026 at 3:00 PM');
  });

  it('describes a rule in words', () => {
    expect(describeRule(weekly(1, '14:00'))).toBe('Every Monday at 2:00 PM');
    expect(describeRule(monthly(0, '09:00'))).toBe(
      'On the last day of every month at 9:00 AM',
    );
    expect(describeRule(monthly(2, '09:00'))).toBe(
      'On the 2nd of every month at 9:00 AM',
    );
  });
});
