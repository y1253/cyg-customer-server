"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.feedCents = feedCents;
exports.monthOf = monthOf;
exports.planMonths = planMonths;
exports.monthLabel = monthLabel;
exports.kindOfPlaidType = kindOfPlaidType;
exports.defaultAccountName = defaultAccountName;
exports.isoDay = isoDay;
exports.bankDelayNote = bankDelayNote;
function feedCents(plaidAmount) {
    return -Math.round(Number(plaidAmount) * 100);
}
function monthOf(date) {
    return date.slice(0, 7);
}
function lastDayOf(month) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${month}-${String(d).padStart(2, '0')}`;
}
function nextMonth(month) {
    const [y, m] = month.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
function overlaps(a, b) {
    return a.start <= b.end && a.end >= b.start;
}
function planMonths(input) {
    const txns = [...input.txns].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    if (!txns.length)
        return [];
    const lastDate = txns[txns.length - 1].date > input.today
        ? txns[txns.length - 1].date
        : input.today;
    const months = [];
    for (let m = monthOf(txns[0].date); m <= monthOf(lastDate); m = nextMonth(m))
        months.push(m);
    const byMonth = new Map(months.map((m) => [m, []]));
    for (const t of txns)
        byMonth.get(monthOf(t.date)).push(t);
    const plans = [];
    let closing = input.currentCents;
    for (let i = months.length - 1; i >= 0; i--) {
        const month = months[i];
        const rows = byMonth.get(month);
        const net = rows.reduce((s, t) => s + t.cents, 0);
        const opening = closing === null
            ? null
            : input.kind === 'CREDIT_CARD'
                ? closing + net
                : closing - net;
        plans.push({
            periodStart: i === 0 ? txns[0].date : `${month}-01`,
            periodEnd: i === months.length - 1 ? lastDate : lastDayOf(month),
            openingCents: opening,
            closingCents: closing,
            txnIds: rows.map((t) => t.id),
        });
        closing = opening;
    }
    plans.reverse();
    const kept = input.startDate
        ? fromStartDate(plans, txns, input.kind, input.startDate)
        : plans;
    const covered = input.covered ?? [];
    return kept.filter((p) => !covered.some((c) => overlaps({ start: p.periodStart, end: p.periodEnd }, c)));
}
function fromStartDate(plans, txns, kind, start) {
    const dateOf = new Map(txns.map((t) => [t.id, t]));
    const out = [];
    for (const p of plans) {
        if (p.periodEnd < start)
            continue;
        if (p.periodStart >= start) {
            out.push(p);
            continue;
        }
        const txnIds = p.txnIds.filter((id) => dateOf.get(id).date >= start);
        const net = txnIds.reduce((s, id) => s + dateOf.get(id).cents, 0);
        const opening = p.closingCents === null
            ? null
            : kind === 'CREDIT_CARD'
                ? p.closingCents + net
                : p.closingCents - net;
        out.push({ ...p, periodStart: start, openingCents: opening, txnIds });
    }
    return out;
}
function monthLabel(periodStart) {
    const [y, m] = periodStart.split('-').map(Number);
    const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
        month: 'short',
        timeZone: 'UTC',
    });
    return `${name} ${y}`;
}
function kindOfPlaidType(type) {
    return type === 'credit' ? 'CREDIT_CARD' : 'BANK';
}
function defaultAccountName(institution, account) {
    const bank = institution?.trim() || account.name.trim() || 'Bank';
    return (account.mask ? `${bank} ${account.mask}` : `${bank} ${account.name}`).slice(0, 191);
}
function isoDay(d = new Date()) {
    return d.toISOString().slice(0, 10);
}
function bankDelayNote(institutionName, updates, bankStatus) {
    if (!updates?.last_failed_update || updates.last_successful_update) {
        return null;
    }
    const bank = institutionName?.trim() || 'your bank';
    if (bankStatus === 'DOWN' || bankStatus === 'DEGRADED') {
        return (`${bank} isn't sending transactions to Plaid right now — a problem on the bank's ` +
            'side. We keep checking every few minutes and bring them in automatically once it is back.');
    }
    return `Plaid couldn't get your transactions from ${bank} yet. We keep trying every few minutes.`;
}
//# sourceMappingURL=bank-feed.util.js.map