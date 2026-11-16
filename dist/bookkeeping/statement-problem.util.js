"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROBLEM_TITLES = exports.PROBLEM_ORDER = void 0;
exports.statementProblem = statementProblem;
exports.statementErrors = statementErrors;
exports.printedEnding = printedEnding;
exports.needsReviewText = needsReviewText;
exports.money = money;
const reconcile_util_1 = require("./reconcile.util");
const statement_order_util_1 = require("./statement-order.util");
exports.PROBLEM_ORDER = [
    'BALANCE',
    'ENDING',
    'RUNNING',
    'MISMATCH',
    'MISSING',
    'NO_OPENING',
    'NO_BALANCES',
];
exports.PROBLEM_TITLES = {
    BALANCE: "Transactions don't match the balance",
    ENDING: "Ending balance doesn't match",
    RUNNING: "Ending balance doesn't match the running balance",
    MISMATCH: "Statement didn't match",
    MISSING: 'Missing statements',
    NO_OPENING: 'No starting balance',
    NO_BALANCES: "Couldn't check — balances not read",
};
const TOTALS_TITLE = "Transactions don't match the bank's totals";
function statementProblem(s) {
    return statementErrors(s)[0] ?? null;
}
function statementErrors(s) {
    if (s.status === 'NEEDS_REVIEW')
        return [balanceProblem(s)];
    if (s.status !== 'DONE')
        return [];
    return [
        endingProblem(s),
        runningProblem(s),
        chainProblem(s),
        noOpeningProblem(s),
        noBalancesProblem(s),
    ].filter((p) => p !== null);
}
function balanceProblem(s) {
    const balance = storedChecks(s.verificationDetail).find((c) => c.name === 'balance' && c.page == null);
    return {
        kind: 'BALANCE',
        title: !balance || balance.ok ? TOTALS_TITLE : exports.PROBLEM_TITLES.BALANCE,
        text: s.error ??
            "Its transactions don't add up to the statement's own balances. Nothing from it is in your books yet.",
    };
}
function chainProblem(s) {
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
        return {
            kind: 'MISMATCH',
            title: exports.PROBLEM_TITLES.MISMATCH,
            text: head + tail,
        };
    }
    if (r?.kind === 'MISSING') {
        const to = r.to ? `to ${longDay(r.to)}` : 'up to this one';
        const restart = s.openingBalance === null
            ? ''
            : ` Your books start again here at ${money(s.openingBalance)}.`;
        const jump = r.previousClosing != null &&
            s.openingBalance !== null &&
            Math.round(r.previousClosing * 100) !== Math.round(s.openingBalance * 100)
            ? ` The statement before it ends at ${money(r.previousClosing)}; this one opens at ${money(s.openingBalance)}.`
            : '';
        return {
            kind: 'MISSING',
            title: exports.PROBLEM_TITLES.MISSING,
            text: `No statement from ${longDay(r.from)} ${to}.${jump}${restart} Upload the missing statement${r.to && monthsBetween(r.from, r.to) > 1 ? 's' : ''} to fix it.`,
        };
    }
    return null;
}
function noOpeningProblem(s) {
    if (s.source === 'PLAID' || s.startDerived !== 'ZERO')
        return null;
    if (s.openingBalance !== null || s.closingBalance !== null)
        return null;
    return {
        kind: 'NO_OPENING',
        title: exports.PROBLEM_TITLES.NO_OPENING,
        text: "We couldn't read a starting balance on this statement, and no closing balance to work one out from, so your books start this account at $0.00 here. " +
            'Try again, or tell the AI the starting balance printed on it.',
    };
}
function noBalancesProblem(s) {
    if (noOpeningProblem(s))
        return null;
    if (s.source !== 'PLAID' && s.verification === 'UNVERIFIED') {
        const which = s.openingBalance === null && s.closingBalance === null
            ? 'opening or closing balance'
            : s.openingBalance === null
                ? 'opening balance'
                : 'closing balance';
        return {
            kind: 'NO_BALANCES',
            title: exports.PROBLEM_TITLES.NO_BALANCES,
            text: `We couldn't read this statement's ${which}, so nothing checked its transactions. They are in your books as read — tell the AI the balances printed on it to check them.`,
        };
    }
    return null;
}
function endingProblem(s) {
    if (s.source === 'PLAID' || s.net === undefined)
        return null;
    if (s.openingBalance === null || s.closingBalance === null)
        return null;
    const card = s.accountKind === 'CREDIT_CARD';
    const c = (n) => Math.round(n * 100);
    const should = c(s.openingBalance) + (card ? -1 : 1) * c(s.net);
    const ends = c(s.closingBalance);
    if (should === ends)
        return null;
    const moneyIn = s.net > 0 ? s.net : 0;
    const moneyOut = s.net < 0 ? -s.net : 0;
    return {
        kind: 'ENDING',
        title: exports.PROBLEM_TITLES.ENDING,
        text: `It starts at ${money(s.openingBalance)}; with the transactions we read (net ${moneyIn ? `${money(moneyIn)} in` : `${money(moneyOut)} out`}) it should end at ${money(should / 100)}, ` +
            `but the statement ends at ${money(s.closingBalance)} (off by ${money(Math.abs(ends - should) / 100)}). ` +
            'Its transactions are in your books as read — try again, or ask the AI to fix it.',
        details: {
            opening: s.openingBalance,
            net: s.net,
            expected: should / 100,
            closing: s.closingBalance,
        },
    };
}
function runningProblem(s) {
    if (s.source === 'PLAID')
        return null;
    if (s.printedEnding === undefined || s.printedEnding === null)
        return null;
    const running = storedChecks(s.verificationDetail).find((c) => c.name === 'runningBalance' && c.page == null);
    if (running?.skipped)
        return null;
    const card = s.accountKind === 'CREDIT_CARD';
    const c = (n) => Math.round(n * 100);
    const target = s.closingBalance !== null
        ? { cents: c(s.closingBalance), what: 'its closing balance' }
        : s.openingBalance !== null && s.net !== undefined
            ? {
                cents: c(s.openingBalance) + (card ? -1 : 1) * c(s.net),
                what: 'its starting balance plus its transactions',
            }
            : null;
    if (!target)
        return null;
    const printed = c(s.printedEnding);
    if (Math.abs(printed) === Math.abs(target.cents))
        return null;
    const off = Math.abs(Math.abs(printed) - Math.abs(target.cents));
    return {
        kind: 'RUNNING',
        title: exports.PROBLEM_TITLES.RUNNING,
        text: `The running balance after its last transaction is ${money(printed / 100)}, but ${target.what} comes to ${money(target.cents / 100)} (off by ${money(off / 100)}). ` +
            'A transaction was probably misread or missed — try again, or ask the AI to fix it.',
        details: { printedEnding: printed / 100, expected: target.cents / 100 },
    };
}
function printedEnding(rows, card = false) {
    const ordered = (0, statement_order_util_1.chronological)(rows);
    let k = -1;
    for (let i = ordered.length - 1; i >= 0; i--) {
        if (ordered[i].balanceAfter !== null) {
            k = i;
            break;
        }
    }
    if (k < 0)
        return null;
    const direction = (0, statement_order_util_1.balanceDirection)(ordered, card);
    const after = ordered
        .slice(k + 1)
        .reduce((t, r) => t + Math.round((r.amount ?? 0) * 100), 0);
    return (Math.round(ordered[k].balanceAfter * 100) + direction * after) / 100;
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