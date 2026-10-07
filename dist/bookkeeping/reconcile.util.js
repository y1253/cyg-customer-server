"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.score = exports.cents = void 0;
exports.reconcile = reconcile;
exports.describeCheck = describeCheck;
const cents = (n) => Math.round(n * 100);
exports.cents = cents;
function reconcile(stated, rows) {
    const amounts = rows.map((r) => (0, exports.cents)(r.amount));
    const inSum = amounts.filter((a) => a > 0).reduce((s, a) => s + a, 0);
    const outSum = -amounts.filter((a) => a < 0).reduce((s, a) => s + a, 0);
    const net = inSum - outSum;
    const totals = [];
    if (stated.totalDeposits !== null) {
        totals.push(check('deposits', (0, exports.cents)(Math.abs(stated.totalDeposits)), inSum));
    }
    if (stated.totalWithdrawals !== null) {
        totals.push(check('withdrawals', (0, exports.cents)(Math.abs(stated.totalWithdrawals)), outSum));
    }
    const counts = [];
    if (stated.depositCount !== null) {
        const actual = amounts.filter((a) => a > 0).length;
        counts.push(check('depositCount', stated.depositCount, actual));
    }
    if (stated.withdrawalCount !== null) {
        const actual = amounts.filter((a) => a < 0).length;
        counts.push(check('withdrawalCount', stated.withdrawalCount, actual));
    }
    const asPrinted = balanceChecks(stated, rows, amounts, net, 1);
    const owed = balanceChecks(stated, rows, amounts, net, -1);
    const balances = fit(owed) > fit(asPrinted) ? owed : asPrinted;
    const reason = skipReason(stated, balances);
    for (const c of [...totals, ...counts]) {
        if (!c.ok && reason)
            c.skipped = reason;
    }
    const checks = [
        ...totals,
        ...(balances.balance ? [balances.balance] : []),
        ...counts,
        ...(balances.running ? [balances.running] : []),
    ];
    const counted = checks.filter((c) => !c.skipped);
    const verification = !counted.length
        ? 'UNVERIFIED'
        : counted.every((c) => c.ok)
            ? 'VERIFIED'
            : 'MISMATCH';
    return {
        verification,
        checks,
        suspectPages: [...balances.suspect].sort((a, b) => a - b),
    };
}
const check = (name, expected, actual) => ({
    name,
    expected,
    actual,
    ok: expected === actual,
    skipped: null,
});
function balanceChecks(stated, rows, amounts, net, sign) {
    const bal = (n) => (n === null ? null : sign * (0, exports.cents)(n));
    const opening = bal(stated.openingBalance);
    const closing = bal(stated.closingBalance);
    const balance = opening !== null && closing !== null
        ? check('balance', closing, opening + net)
        : null;
    const printed = rows.map((r) => bal(r.balanceAfter));
    const pages = rows.map((r) => r.page);
    const forward = runningBalance(printed, amounts, pages, opening);
    const backward = runningBalance([...printed].reverse(), [...amounts].reverse(), [...pages].reverse(), opening);
    const chain = backward.links > 0 && backward.broken < forward.broken ? backward : forward;
    const running = chain.links > 0
        ? check('runningBalance', chain.links, chain.links - chain.broken)
        : null;
    const dep = stated.totalDeposits;
    const wd = stated.totalWithdrawals;
    const selfConsistent = opening !== null && closing !== null && dep !== null && wd !== null
        ? opening + (0, exports.cents)(Math.abs(dep)) - (0, exports.cents)(Math.abs(wd)) === closing
        : null;
    return { balance, running, suspect: chain.suspect, selfConsistent };
}
function fit(b) {
    const passing = (b.balance?.ok ? 1 : 0) + (b.running?.ok ? 1 : 0);
    const broken = b.running ? b.running.expected - b.running.actual : 0;
    return passing * 1e9 + (b.selfConsistent ? 1e6 : 0) - broken;
}
function skipReason(stated, b) {
    if (b.selfConsistent === false) {
        return "the statement's totals don't add up to its own opening and closing balance, so they count something else";
    }
    if (b.running?.ok && b.balance?.ok) {
        return "every row matches the bank's running balance, so the printed figure counts something different";
    }
    if (stated.totalsScope === 'partial' && b.selfConsistent !== true) {
        return 'the printed figure does not cover every transaction on the statement';
    }
    return null;
}
function runningBalance(printed, amounts, pages, opening) {
    const suspect = new Set();
    let prev = opening;
    let links = 0;
    let broken = 0;
    printed.forEach((balance, i) => {
        if (balance === null) {
            if (prev !== null)
                prev += amounts[i];
            return;
        }
        if (prev !== null) {
            links++;
            if (prev + amounts[i] !== balance) {
                broken++;
                suspect.add(pages[i]);
            }
        }
        prev = balance;
    });
    return { links, broken, suspect };
}
const score = (r) => r.checks.filter((c) => c.ok && !c.skipped).length;
exports.score = score;
const CHECK_LABEL = {
    deposits: 'Deposits',
    withdrawals: 'Withdrawals',
    balance: 'Ending balance',
    depositCount: 'Number of deposits',
    withdrawalCount: 'Number of withdrawals',
    runningBalance: 'Running balance',
};
function describeCheck(c) {
    if (c.skipped)
        return `${CHECK_LABEL[c.name]}: not compared — ${c.skipped}`;
    const money = (v) => `${v < 0 ? '-' : ''}$${(Math.abs(v) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    switch (c.name) {
        case 'deposits':
        case 'withdrawals':
        case 'balance': {
            const label = c.name === 'balance'
                ? 'Ending balance'
                : c.name === 'deposits'
                    ? 'Deposits'
                    : 'Withdrawals';
            return c.ok
                ? `${label} ${money(c.expected)} ✓`
                : `${label}: statement ${money(c.expected)}, read ${money(c.actual)} (off by ${money(Math.abs(c.expected - c.actual))})`;
        }
        case 'depositCount':
        case 'withdrawalCount': {
            const label = c.name === 'depositCount' ? 'deposits' : 'withdrawals';
            return c.ok
                ? `${c.expected} ${label} ✓`
                : `Number of ${label}: statement ${c.expected}, read ${c.actual}`;
        }
        case 'runningBalance':
            return c.ok
                ? 'Running balance ✓'
                : `Running balance breaks on ${c.expected - c.actual} of ${c.expected} rows`;
    }
}
//# sourceMappingURL=reconcile.util.js.map