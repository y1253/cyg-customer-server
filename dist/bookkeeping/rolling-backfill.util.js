"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.changes = exports.RANK = void 0;
exports.planStatementFix = planStatementFix;
const reconcile_util_1 = require("./reconcile.util");
const sign_repair_1 = require("./sign-repair");
const statement_extractor_1 = require("./statement-extractor");
exports.RANK = {
    MISMATCH: 0,
    UNVERIFIED: 1,
    VERIFIED: 2,
};
const isCard = (s) => s.accountKind === 'CREDIT_CARD';
function check(s, rows) {
    return (0, reconcile_util_1.reconcile)({
        openingBalance: s.openingBalance,
        closingBalance: s.closingBalance,
        totalDeposits: s.statedDeposits,
        totalWithdrawals: s.statedWithdrawals,
        depositCount: s.statedDepositCount,
        withdrawalCount: s.statedWithdrawalCount,
    }, rows.map((r) => ({ ...r, page: 0 })));
}
function planStatementFix(s, rows) {
    const fix = { flips: [], balances: [] };
    if (!rows.length)
        return fix;
    let amounts = rows.map((r) => r.amount);
    const totals = {
        deposits: s.statedDeposits,
        withdrawals: s.statedWithdrawals,
        depositCount: s.statedDepositCount,
        withdrawalCount: s.statedWithdrawalCount,
    };
    if ((0, reconcile_util_1.totalsCoverAll)({
        totalDeposits: s.statedDeposits,
        totalWithdrawals: s.statedWithdrawals,
        depositCount: s.statedDepositCount,
        withdrawalCount: s.statedWithdrawalCount,
    }, amounts.map(reconcile_util_1.cents))) {
        amounts = (0, sign_repair_1.repairSignsFromTotals)(amounts.map((amount) => ({ amount })), totals).amounts;
    }
    const signRows = rows.map((r, i) => ({
        amount: amounts[i],
        balanceAfter: r.balanceAfter,
    }));
    const balances = (0, sign_repair_1.repairBalanceSigns)(signRows, s.openingBalance).balances;
    amounts = (0, sign_repair_1.repairSigns)(signRows.map((r, i) => ({ ...r, balanceAfter: balances[i] })), s.openingBalance).amounts;
    const after = rows.map((r, i) => ({
        ...r,
        amount: amounts[i],
        balanceAfter: balances[i],
    }));
    const before = check(s, rows);
    let result = before;
    let current = rows;
    const flips = rows
        .filter((r, i) => (0, reconcile_util_1.cents)(r.amount) !== (0, reconcile_util_1.cents)(amounts[i]))
        .map((r) => r.id);
    const balanceChanges = rows
        .map((r, i) => ({ id: r.id, from: r.balanceAfter, to: balances[i] }))
        .filter((b) => (b.from === null ? null : (0, reconcile_util_1.cents)(b.from)) !==
        (b.to === null ? null : (0, reconcile_util_1.cents)(b.to)));
    if (flips.length || balanceChanges.length) {
        const candidate = check(s, after);
        if (rows.some((r) => r.locked && flips.includes(r.id))) {
            fix.skipped = 'a row to flip has splits';
        }
        else if (exports.RANK[candidate.verification] >= exports.RANK[before.verification] &&
            (0, reconcile_util_1.score)(candidate) > (0, reconcile_util_1.score)(before)) {
            fix.flips = flips;
            fix.balances = balanceChanges.map((b) => ({
                id: b.id,
                balanceAfter: b.to,
            }));
            result = candidate;
            current = after;
        }
        else {
            fix.skipped = 'the repaired rows do not check out better';
        }
    }
    if (!isCard(s) && (s.openingBalance === null || s.closingBalance === null)) {
        const derived = (0, statement_extractor_1.balancesFromRunning)(current, result);
        if (derived) {
            const opening = s.openingBalance ?? derived.opening;
            const closing = s.closingBalance ?? derived.closing;
            const net = current.reduce((t, r) => t + (0, reconcile_util_1.cents)(r.amount), 0);
            if (opening !== null &&
                closing !== null &&
                (0, reconcile_util_1.cents)(opening) + net === (0, reconcile_util_1.cents)(closing)) {
                if (s.openingBalance === null)
                    fix.opening = opening;
                if (s.closingBalance === null)
                    fix.closing = closing;
                result = check({ ...s, openingBalance: opening, closingBalance: closing }, current);
            }
        }
    }
    if ((fix.flips.length ||
        fix.balances.length ||
        fix.opening !== undefined ||
        fix.closing !== undefined) &&
        exports.RANK[result.verification] > exports.RANK[s.verification ?? 'UNVERIFIED']) {
        fix.verification = result.verification;
        fix.detail = result.checks.map((c) => ({ ...c, text: (0, reconcile_util_1.describeCheck)(c) }));
    }
    return fix;
}
const changes = (f) => f.flips.length > 0 ||
    f.balances.length > 0 ||
    f.opening !== undefined ||
    f.closing !== undefined ||
    f.verification !== undefined;
exports.changes = changes;
//# sourceMappingURL=rolling-backfill.util.js.map