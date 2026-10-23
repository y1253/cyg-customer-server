"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TIMEZONE = exports.AI_FREQUENCIES = exports.FREQUENCIES = void 0;
exports.parseDate = parseDate;
exports.safeZone = safeZone;
exports.parseTime = parseTime;
exports.wallClock = wallClock;
exports.zonedInstant = zonedInstant;
exports.nextRun = nextRun;
exports.previousMonth = previousMonth;
exports.describeRule = describeRule;
exports.FREQUENCIES = ['WEEKLY', 'MONTHLY'];
exports.AI_FREQUENCIES = [
    'DAILY',
    'WEEKLY',
    'MONTHLY',
    'ONCE',
];
function parseDate(date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date?.trim() ?? '');
    if (!m)
        return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo))
        return null;
    return [y, mo, d];
}
exports.DEFAULT_TIMEZONE = 'America/Toronto';
function safeZone(tz) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz ?? exports.DEFAULT_TIMEZONE });
        return tz || exports.DEFAULT_TIMEZONE;
    }
    catch {
        return exports.DEFAULT_TIMEZONE;
    }
}
function parseTime(time) {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time?.trim() ?? '');
    return m ? [Number(m[1]), Number(m[2])] : null;
}
function wallClock(at, tz) {
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
    const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
    const DOW = {
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
        h: Number(get('hour')) % 24,
        min: Number(get('minute')),
        dow: DOW[get('weekday')] ?? 0,
    };
}
function zonedInstant(y, m, d, h, min, tz) {
    const guess = Date.UTC(y, m - 1, d, h, min);
    let at = guess;
    for (let i = 0; i < 2; i++) {
        const w = wallClock(new Date(at), tz);
        const shown = Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
        at += guess - shown;
    }
    return new Date(at);
}
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function nextRun(rule, after) {
    const hm = parseTime(rule.time);
    if (!hm)
        return null;
    const tz = safeZone(rule.timezone);
    if (rule.frequency === 'ONCE') {
        const ymd = parseDate(rule.date);
        if (!ymd)
            return null;
        const at = zonedInstant(ymd[0], ymd[1], ymd[2], hm[0], hm[1], tz);
        return at.getTime() > after.getTime() ? at : null;
    }
    const start = wallClock(after, tz);
    for (let i = 0; i <= 70; i++) {
        const day = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
        const y = day.getUTCFullYear();
        const m = day.getUTCMonth() + 1;
        const d = day.getUTCDate();
        if (rule.frequency === 'DAILY') {
        }
        else if (rule.frequency === 'WEEKLY') {
            if (rule.weekday === null || day.getUTCDay() !== rule.weekday)
                continue;
        }
        else {
            const want = rule.monthDay ?? 1;
            const target = want === 0 ? daysIn(y, m) : Math.min(want, 28);
            if (d !== target)
                continue;
        }
        const at = zonedInstant(y, m, d, hm[0], hm[1], tz);
        if (at.getTime() > after.getTime())
            return at;
    }
    return null;
}
function previousMonth(at, tz) {
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
function describeRule(rule) {
    const hm = parseTime(rule.time);
    const time = hm
        ? new Date(Date.UTC(2000, 0, 1, hm[0], hm[1])).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'UTC',
        })
        : rule.time;
    if (rule.frequency === 'DAILY')
        return `Every day at ${time}`;
    if (rule.frequency === 'ONCE') {
        const ymd = parseDate(rule.date);
        if (!ymd)
            return `Once at ${time}`;
        const day = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2])).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
        });
        return `Once, on ${day} at ${time}`;
    }
    if (rule.frequency === 'WEEKLY') {
        return `Every ${WEEKDAY_NAMES[rule.weekday ?? 1]} at ${time}`;
    }
    const d = rule.monthDay ?? 1;
    const nth = d === 0
        ? 'last day'
        : `${d}${d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'}`;
    return `On the ${nth} of every month at ${time}`;
}
//# sourceMappingURL=next-run.util.js.map