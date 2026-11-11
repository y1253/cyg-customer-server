"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROBLEM_TITLES = void 0;
exports.statementProblem = statementProblem;
exports.needsReviewText = needsReviewText;
exports.money = money;
const reconcile_util_1 = require("./reconcile.util");
exports.PROBLEM_TITLES = {
    BALANCE: "Transactions don't match the balance",
    MISMATCH: "Statement didn't match",
    MISSING: 'Missing statements',
    NO_BALANCES: "Couldn't check — balances not read",
};
const TOTALS_TITLE = "Transactions don't match the bank's totals";
function statementProblem(s) {
    if (s.status === 'NEEDS_REVIEW') {
        const balance = storedChecks(s.verificationDetail).find((c) => c.name === 'balance' && c.page == null);
        return {
            kind: 'BALANCE',
            title: !balance || balance.ok ? TOTALS_TITLE : exports.PROBLEM_TITLES.BALANCE,
            text: s.error ??
                "Its transactions don't add up to the statement's own balances. Nothing from it is in your books yet.",
        };
    }
    if (s.status !== 'DONE')
        return null;
    const r = s.reason;
    if (r?.kind === 'MISMATCH') {
        const before = r.previousEnd
            ? `The statement ending ${longDay(r.previousEnd)}`
            : 'The statement before it';
        const closed = r.previousClosing === null
            ? 'has no closing balance we could read'
            : `closes at ${money(r.previousClosing)}`;
        const head = `${before} ${closed}; this one opens at ${money(r.opening)}.`;
        const tail = s.rechecking
            ? " We're re-reading both with our strongest reader."
            : s.rechecked
                ? ` We re-read both with our strongest reader and they still don't match, so your books start again here at ${money(r.opening)}.`
                : ` Your books start again here at ${money(r.opening)}.`;
        return { kind: 'MISMATCH', title: exports.PROBLEM_TITLES.MISMATCH, text: head + tail };
    }
    if (r?.kind === 'MISSING') {
        const to = r.to ? `to ${longDay(r.to)}` : 'up to this one';
        const restart = s.openingBalance === null
            ? ''
            : ` Your books start again here at ${money(s.openingBalance)}.`;
        return {
            kind: 'MISSING',
            title: exports.PROBLEM_TITLES.MISSING,
            text: `No statement from ${longDay(r.from)} ${to}.${restart} Upload the missing statement${r.to && monthsBetween(r.from, r.to) > 1 ? 's' : ''} to fix it.`,
        };
    }
    if (s.source !== 'PLAID' &&
        Array.isArray(s.verificationDetail) &&
        !storedChecks(s.verificationDetail).some((c) => c.name === 'balance')) {
        const which = s.openingBalance === null && s.closingBalance === null
            ? 'opening or closing balance'
            : s.openingBalance === null
                ? 'opening balance'
                : 'closing balance';
        return {
            kind: 'NO_BALANCES',
            title: exports.PROBLEM_TITLES.NO_BALANCES,
            text: `We couldn't read this statement's ${which}, even with our strongest reader, so its transactions could not be checked against it. They are in your books as read — tell the AI the balances printed on it to check them.`,
        };
    }
    return null;
}
function needsReviewText(input) {
    const failed = input.checks.filter((c) => !c.ok && !c.skipped);
    const balance = failed.find((c) => c.name === 'balance' && c.page == null);
    let what;
    if (balance && input.openingBalance !== null) {
        const cents = input.amounts.map((a) => Math.round(a * 100));
        const moneyIn = cents.filter((a) => a > 0).reduce((t, a) => t + a, 0);
        const moneyOut = -cents.filter((a) => a < 0).reduce((t, a) => t + a, 0);
        what =
            `It starts at ${money(input.openingBalance)}; with the money in (${money(moneyIn / 100)}) and out (${money(moneyOut / 100)}) we read, it should end at ${money(balance.actual / 100)} — ` +
                `but the statement ends at ${money(balance.expected / 100)} (off by ${money(Math.abs(balance.expected - balance.actual) / 100)}).`;
    }
    else {
        what = `The transactions we read don't add up to the bank's own figures: ${failed.map(reconcile_util_1.describeCheck).join('; ') || 'its totals'}.`;
    }
    const times = `${input.rereads} time${input.rereads === 1 ? '' : 's'}`;
    return (`${what} We re-read it ${times}, including with our strongest reader. ` +
        'Nothing from it is in your books yet — try again, or ask the AI to fix it.');
}
function storedChecks(detail) {
    return Array.isArray(detail)
        ? detail.filter((c) => c && typeof c === 'object')
        : [];
}
function money(n) {
    const abs = Math.abs(n).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    return `${n < 0 ? '-' : ''}$${abs}`;
}
function longDay(iso) {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime())
        ? iso
        : d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
        });
}
function monthsBetween(from, to) {
    const [fy, fm] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    return (ty - fy) * 12 + (tm - fm) + 1;
}
//# sourceMappingURL=statement-problem.util.js.map