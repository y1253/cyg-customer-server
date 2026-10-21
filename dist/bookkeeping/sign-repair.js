"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repairBalanceSigns = repairBalanceSigns;
exports.repairSigns = repairSigns;
exports.segmentSigns = segmentSigns;
exports.repairSignsFromTotals = repairSignsFromTotals;
function repairBalanceSigns(rows, openingBalance) {
    const unchanged = {
        balances: rows.map((r) => r.balanceAfter),
        fixes: 0,
    };
    if (!rows.some((r) => r.balanceAfter !== null))
        return unchanged;
    let best = null;
    for (const sign of [1, -1]) {
        for (const reversed of [false, true]) {
            const order = rows.map((_, i) => i);
            if (reversed)
                order.reverse();
            const pass = walkBalances(order.map((i) => rows[i]), openingBalance, sign);
            const balances = new Array(rows.length);
            order.forEach((i, k) => (balances[i] = pass.balances[k]));
            if (!best ||
                pass.links > best.links ||
                (pass.links === best.links && pass.fixes < best.fixes)) {
                best = { links: pass.links, fixes: pass.fixes, balances };
            }
        }
    }
    return best && best.fixes > 0
        ? { balances: best.balances, fixes: best.fixes }
        : unchanged;
}
function walkBalances(rows, openingBalance, sign) {
    const out = rows.map((r) => r.balanceAfter === null ? null : sign * cents(r.balanceAfter));
    let prev = openingBalance === null ? null : sign * cents(openingBalance);
    let prevIndex = -1;
    let prevConfirmed = openingBalance !== null;
    let sum = 0;
    let links = 0;
    let fixes = 0;
    rows.forEach((r, i) => {
        sum += cents(r.amount);
        const printed = out[i];
        if (printed === null)
            return;
        let confirmed = false;
        if (prev !== null) {
            if (prev + sum === printed) {
                confirmed = true;
            }
            else if (printed !== 0 && prev + sum === -printed) {
                out[i] = -printed;
                fixes++;
                confirmed = true;
            }
            else if (!prevConfirmed &&
                prevIndex >= 0 &&
                prev !== 0 &&
                -prev + sum === printed) {
                out[prevIndex] = -prev;
                fixes++;
                confirmed = true;
            }
            if (confirmed)
                links++;
        }
        prev = out[i];
        prevIndex = i;
        prevConfirmed = confirmed;
        sum = 0;
    });
    return {
        balances: out.map((v) => (v === null ? null : (sign * v) / 100)),
        links,
        fixes,
    };
}
const MAX_SEGMENT = 18;
const cents = (n) => Math.round(n * 100);
function repairSigns(rows, openingBalance) {
    const unchanged = {
        amounts: rows.map((r) => r.amount),
        flips: 0,
    };
    if (!rows.some((r) => r.balanceAfter !== null))
        return unchanged;
    let best = null;
    for (const sign of [1, -1]) {
        for (const reversed of [false, true]) {
            const order = rows.map((_, i) => i);
            if (reversed)
                order.reverse();
            const pass = walk(order.map((i) => rows[i]), openingBalance, sign);
            const amounts = new Array(rows.length);
            order.forEach((i, k) => (amounts[i] = pass.amounts[k]));
            if (!best ||
                pass.links > best.links ||
                (pass.links === best.links && pass.flips < best.flips)) {
                best = { links: pass.links, flips: pass.flips, amounts };
            }
        }
    }
    return best && best.flips > 0
        ? { amounts: best.amounts, flips: best.flips }
        : unchanged;
}
function walk(rows, openingBalance, sign) {
    const amounts = rows.map((r) => cents(r.amount));
    let prev = openingBalance === null ? null : sign * cents(openingBalance);
    let start = 0;
    let links = 0;
    let flips = 0;
    rows.forEach((r, i) => {
        if (r.balanceAfter === null)
            return;
        const printed = sign * cents(r.balanceAfter);
        if (prev !== null) {
            const segment = amounts.slice(start, i + 1);
            const target = printed - prev;
            const fixed = segmentSigns(segment, target);
            if (fixed) {
                links++;
                fixed.forEach((a, k) => {
                    if (a !== amounts[start + k])
                        flips++;
                    amounts[start + k] = a;
                });
            }
        }
        prev = printed;
        start = i + 1;
    });
    return { amounts: amounts.map((a) => a / 100), links, flips };
}
function segmentSigns(segment, target) {
    const sum = segment.reduce((s, a) => s + a, 0);
    if (sum === target)
        return segment;
    const idx = segment.map((a, i) => (a !== 0 ? i : -1)).filter((i) => i >= 0);
    if (!idx.length || idx.length > MAX_SEGMENT)
        return null;
    const abs = idx.map((i) => Math.abs(segment[i]));
    const modelNegative = idx.map((i) => segment[i] < 0);
    let bestFlips = Infinity;
    let bestMask = -1;
    let ties = 0;
    for (let mask = 0; mask < 1 << idx.length; mask++) {
        let s = 0;
        let f = 0;
        for (let k = 0; k < idx.length; k++) {
            const negative = (mask & (1 << k)) !== 0;
            s += negative ? -abs[k] : abs[k];
            if (negative !== modelNegative[k])
                f++;
        }
        if (s !== target)
            continue;
        if (f < bestFlips) {
            bestFlips = f;
            bestMask = mask;
            ties = 1;
        }
        else if (f === bestFlips) {
            ties++;
        }
    }
    if (bestMask < 0 || ties > 1)
        return null;
    const out = [...segment];
    idx.forEach((i, k) => {
        out[i] = (bestMask & (1 << k)) !== 0 ? -abs[k] : abs[k];
    });
    return out;
}
const MAX_TOTALS_FLIPS = 3;
function repairSignsFromTotals(rows, totals) {
    const unchanged = {
        amounts: rows.map((r) => r.amount),
        flips: 0,
    };
    if (totals.deposits === null || totals.withdrawals === null)
        return unchanged;
    const amounts = rows.map((r) => cents(r.amount));
    const inSum = amounts.filter((a) => a > 0).reduce((s, a) => s + a, 0);
    const outSum = -amounts.filter((a) => a < 0).reduce((s, a) => s + a, 0);
    const move = inSum - cents(Math.abs(totals.deposits));
    if (move === 0 || cents(Math.abs(totals.withdrawals)) - outSum !== move) {
        return unchanged;
    }
    const inCount = amounts.filter((a) => a > 0).length;
    const outCount = amounts.filter((a) => a < 0).length;
    const idx = amounts.map((a, i) => (a !== 0 ? i : -1)).filter((i) => i >= 0);
    const fits = (set) => {
        let moved = 0;
        let fromIn = 0;
        for (const i of set) {
            moved += amounts[i];
            if (amounts[i] > 0)
                fromIn++;
        }
        if (moved !== move)
            return false;
        const fromOut = set.length - fromIn;
        if (totals.depositCount !== null &&
            inCount - fromIn + fromOut !== totals.depositCount) {
            return false;
        }
        return (totals.withdrawalCount === null ||
            outCount - fromOut + fromIn === totals.withdrawalCount);
    };
    for (let k = 1; k <= MAX_TOTALS_FLIPS && k <= idx.length; k++) {
        let found = null;
        let ties = 0;
        const pick = (from, set) => {
            if (ties > 1)
                return;
            if (set.length === k) {
                if (fits(set)) {
                    ties++;
                    found = [...set];
                }
                return;
            }
            for (let j = from; j < idx.length; j++) {
                set.push(idx[j]);
                pick(j + 1, set);
                set.pop();
            }
        };
        pick(0, []);
        if (ties > 1)
            return unchanged;
        if (found) {
            const flipped = new Set(found);
            return {
                amounts: amounts.map((a, i) => (flipped.has(i) ? -a : a) / 100),
                flips: flipped.size,
            };
        }
    }
    return unchanged;
}
//# sourceMappingURL=sign-repair.js.map