"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_TEXT_PURPOSES = exports.TRIAL_ITEMS = void 0;
exports.trialUsedUp = trialUsedUp;
exports.accessOf = accessOf;
exports.statusFromStripe = statusFromStripe;
exports.monthOf = monthOf;
exports.nextMonthStart = nextMonthStart;
exports.monthlyUsage = monthlyUsage;
exports.freeUntilAfter = freeUntilAfter;
exports.lockedText = lockedText;
exports.TRIAL_ITEMS = [
    'transactions',
    'texts',
    'callMinutes',
];
const PAID_OPEN = [
    'ACTIVE',
    'TRIALING',
    'PAST_DUE',
];
function trialUsedUp(allowance, used) {
    return exports.TRIAL_ITEMS.filter((k) => used[k] >= allowance[k]);
}
function accessOf(sub, trial, now = new Date()) {
    const s = sub ?? {
        status: 'NONE',
        everPaid: false,
        freeForever: false,
        freeUntil: null,
    };
    if (s.freeForever || (s.freeUntil && s.freeUntil.getTime() > now.getTime()))
        return { active: true, reason: 'FREE', limited: 'MONTHLY' };
    if (PAID_OPEN.includes(s.status))
        return {
            active: true,
            reason: s.status === 'PAST_DUE' ? 'PAST_DUE' : 'PAID',
            limited: 'MONTHLY',
        };
    if (!s.everPaid && trial) {
        if (!trialUsedUp(trial.allowance, trial.used).length)
            return { active: true, reason: 'TRIAL', limited: 'TRIAL' };
        return { active: false, reason: 'TRIAL_USED', limited: null };
    }
    if (s.status === 'UNPAID')
        return { active: false, reason: 'UNPAID', limited: null };
    if (s.everPaid || s.freeUntil || s.status !== 'NONE')
        return { active: false, reason: 'ENDED', limited: null };
    return { active: false, reason: 'NONE', limited: null };
}
function statusFromStripe(status) {
    const map = {
        incomplete: 'INCOMPLETE',
        incomplete_expired: 'INCOMPLETE_EXPIRED',
        trialing: 'TRIALING',
        active: 'ACTIVE',
        past_due: 'PAST_DUE',
        unpaid: 'UNPAID',
        canceled: 'CANCELED',
        paused: 'PAUSED',
    };
    return map[status] ?? 'NONE';
}
const ZONE = 'America/Toronto';
function monthOf(at = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: ZONE,
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(at);
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    return `${y}-${m}`;
}
function nextMonthStart(at = new Date()) {
    const [y, m] = monthOf(at).split('-').map(Number);
    const year = m === 12 ? y + 1 : y;
    const month = m === 12 ? 1 : m + 1;
    for (const h of [4, 5]) {
        const d = new Date(Date.UTC(year, month - 1, 1, h));
        if (monthOf(d) === `${year}-${String(month).padStart(2, '0')}`) {
            const before = new Date(d.getTime() - 3_600_000);
            if (monthOf(before) !== monthOf(d))
                return d;
        }
    }
    return new Date(Date.UTC(year, month - 1, 1, 5));
}
function monthlyUsage(used, limit, warnPercent) {
    const remaining = Math.max(0, limit - used);
    return {
        remaining,
        reached: remaining <= 0,
        warn: limit > 0 && used * 100 >= limit * warnPercent,
    };
}
function freeUntilAfter(current, months, now = new Date()) {
    const from = current && current.getTime() > now.getTime() ? current : now;
    const d = new Date(from);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d;
}
exports.FREE_TEXT_PURPOSES = [
    'LOGIN_CODE',
    'USAGE_LIMIT',
    'TRIAL_NOTICE',
    'FEATURE_DONE',
    'SALES_TEXT',
    'SIGNUP_OFFER',
    'SUBSCRIBE_LINK',
    'INTAKE',
];
function lockedText(reason, usedUp = []) {
    const names = {
        transactions: 'transactions',
        texts: 'AI texts',
        callMinutes: 'AI call minutes',
    };
    switch (reason) {
        case 'TRIAL_USED':
            return `Your free trial is over (you used all its ${usedUp.map((k) => names[k]).join(' and ') || 'allowance'}). Subscribe to keep going.`;
        case 'UNPAID':
            return 'Your last payment did not go through. Update your card to keep going.';
        case 'ENDED':
            return 'Your plan has ended. Subscribe to keep going.';
        default:
            return 'Subscribe to use CYG Finance.';
    }
}
//# sourceMappingURL=entitlement.util.js.map