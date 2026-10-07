"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.score = exports.cents = void 0;
exports.reconcile = reconcile;
exports.describeCheck = describeCheck;
const cents = (n) => Math.round(n * 100);
exports.cents = cents;
function reconcile(stated, rows) {
    const checks = [];
    const amounts = rows.map((r) => (0, exports.cents)(r.amount));
    const inSum = amounts.filter((a) => a > 0).reduce((s, a) => s + a, 0);
    const outSum = -amounts.filter((a) => a < 0).reduce((s, a) => s + a, 0);
    const net = inSum - outSum;
    if (stated.totalDeposits !== null) {
        const expected = (0, exports.cents)(Math.abs(stated.totalDeposits));
        checks.push({
            name: 'deposits',
            expected,
            actual: inSum,
            ok: expected === inSum,
        });
    }
    if (stated.totalWithdrawals !== null) {
        const expected = (0, exports.cents)(Math.abs(stated.totalWithdrawals));
        checks.push({
            name: 'withdrawals',
            expected,
            actual: outSum,
            ok: expected === outSum,
        });
    }
    if (stated.openingBalance !== null && stated.closingBalance !== null) {
        const expected = (0, exports.cents)(stated.closingBalance);
        const actual = (0, exports.cents)(stated.openingBalance) + net;
        checks.push({ name: 'balance', expected, actual, ok: expected === actual });
    }
    if (stated.depositCount !== null) {
        const actual = amounts.filter((a) => a > 0).length;
        checks.push({
            name: 'depositCount',
            expected: stated.depositCount,
            actual,
            ok: actual === stated.depositCount,
        });
    }
    if (stated.withdrawalCount !== null) {
        const actual = amounts.filter((a) => a < 0).length;
        checks.push({
            name: 'withdrawalCount',
            expected: stated.withdrawalCount,
            actual,
            ok: actual === stated.withdrawalCount,
        });
    }
    const forward = runningBalance(rows, amounts, stated.openingBalance);
    const backward = runningBalance([...rows].reverse(), [...amounts].reverse(), stated.openingBalance);
    const chain = backward.links > 0 && backward.broken < forward.broken ? backward : forward;
    if (chain.links > 0) {
        checks.push({
            name: 'runningBalance',
            expected: chain.links,
            actual: chain.links - chain.broken,
            ok: chain.broken === 0,
        });
    }
    const suspect = chain.suspect;
    const verification = !checks.length
        ? 'UNVERIFIED'
        : checks.every((c) => c.ok)
            ? 'VERIFIED'
            : 'MISMATCH';
    return {
        verification,
        checks,
        suspectPages: [...suspect].sort((a, b) => a - b),
    };
}
function runningBalance(rows, amounts, opening) {
    const suspect = new Set();
    let prev = opening !== null ? (0, exports.cents)(opening) : null;
    let links = 0;
    let broken = 0;
    rows.forEach((r, i) => {
        if (r.balanceAfter === null) {
            if (prev !== null)
                prev += amounts[i];
            return;
        }
        const printed = (0, exports.cents)(r.balanceAfter);
        if (prev !== null) {
            links++;
            if (prev + amounts[i] !== printed) {
                broken++;
                suspect.add(r.page);
            }
        }
        prev = printed;
    });
    return { links, broken, suspect };
}
const score = (r) => r.checks.filter((c) => c.ok).length;
exports.score = score;
function describeCheck(c) {
    const money = (v) => `$${(v / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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