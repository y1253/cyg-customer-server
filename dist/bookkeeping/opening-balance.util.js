"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENING_POSITION = exports.OPENING_STATEMENT_SELECT = exports.num = exports.isCreditCard = exports.CREDIT_CARD = exports.STARTING_BALANCE = void 0;
exports.openingRows = openingRows;
exports.openingChain = openingChain;
exports.startsByAccount = startsByAccount;
exports.endingsOf = endingsOf;
exports.ledgerOrder = ledgerOrder;
const chart_of_accounts_1 = require("./chart-of-accounts");
const ledger_util_1 = require("./ledger.util");
const reconcile_util_1 = require("./reconcile.util");
exports.STARTING_BALANCE = 'Starting balance';
function openingRows(statements, bridges = statements.bridges ?? []) {
    return openingChain(statements, bridges).filter((r) => !r.silent);
}
function openingChain(statements, bridges = statements.bridges ?? []) {
    const byAccount = new Map();
    const bridgeRows = bridges.map((b) => ({ ...b, bridgeOnly: true }));
    for (const s of [...statements, ...bridgeRows]) {
        const bank = s.accountName ?? 'Bank account';
        byAccount.set(bank, [...(byAccount.get(bank) ?? []), s]);
    }
    const out = [];
    for (const [bankAccount, list] of byAccount) {
        list.sort((a, b) => chainTime(a) - chainTime(b) || a.id - b.id);
        let carried = [];
        let previous;
        let brokenBridge;
        let inBooks = false;
        for (const s of list) {
            const before = previous;
            previous = s;
            const continues = s.openingBalance !== null && carried.includes((0, reconcile_util_1.cents)(s.openingBalance));
            if (s.bridgeOnly) {
                carried =
                    continues || s.openingBalance === null ? endingsOf(s, carried) : [];
                carried = carried.slice(0, MAX_CARRIED);
                if (continues)
                    brokenBridge = undefined;
                else if (s.openingBalance !== null || brokenBridge)
                    brokenBridge = s;
                continue;
            }
            const review = brokenBridge && reviewReason(brokenBridge);
            brokenBridge = undefined;
            const first = !inBooks;
            inBooks = true;
            const had = carried;
            carried = endingsOf(s, carried).slice(0, MAX_CARRIED);
            if (s.openingBalance === null || (0, reconcile_util_1.cents)(s.openingBalance) === 0) {
                const reason = review || (before && silentBreak(before, s, had));
                if (!reason && !first)
                    continue;
                const worked = s.openingBalance === null ? workedOutOpening(s) : null;
                const derived = s.openingBalance !== null ? undefined : worked === null ? 'ZERO' : 'CLOSING';
                const amount = worked === null ? 0 : worked;
                out.push({
                    statementId: s.id,
                    bankAccount,
                    amount,
                    postingDate: s.periodStart,
                    description: exports.STARTING_BALANCE,
                    offsetAccount: chart_of_accounts_1.OWNERS_LOAN,
                    ...(0, ledger_util_1.doubleEntry)(amount, bankAccount, chart_of_accounts_1.OWNERS_LOAN),
                    periodEnd: s.periodEnd ?? null,
                    ...(reason && { reason }),
                    ...((0, reconcile_util_1.cents)(amount) === 0 && { silent: true }),
                    ...(derived && { derived }),
                });
                continue;
            }
            if (continues)
                continue;
            const sign = (0, exports.isCreditCard)(s.accountKind) ? -1 : 1;
            const amount = (sign * (0, reconcile_util_1.cents)(s.openingBalance)) / 100;
            out.push({
                statementId: s.id,
                bankAccount,
                amount,
                postingDate: s.periodStart,
                description: exports.STARTING_BALANCE,
                offsetAccount: chart_of_accounts_1.OWNERS_LOAN,
                ...(0, ledger_util_1.doubleEntry)(amount, bankAccount, chart_of_accounts_1.OWNERS_LOAN),
                periodEnd: s.periodEnd ?? null,
                ...(review
                    ? { reason: review }
                    : before && { reason: breakReason(before, s) }),
            });
        }
    }
    return out;
}
const chainTime = (s) => (s.periodStart ?? s.periodEnd)?.getTime() ?? -Infinity;
const DAY_MS = 86_400_000;
const isoDay = (d) => d.toISOString().slice(0, 10);
const GAP_TOLERANCE_DAYS = 3;
const MONTH_DAYS = 35;
function breakReason(previous, s) {
    const prevEnd = previous.periodEnd ?? null;
    const computed = previous.openingBalance === null
        ? null
        : ((0, reconcile_util_1.cents)(previous.openingBalance) +
            ((0, exports.isCreditCard)(previous.accountKind) ? -1 : 1) * (0, reconcile_util_1.cents)(previous.net)) /
            100;
    const previousClosing = previous.closingBalance ?? computed;
    if (prevEnd) {
        const expected = prevEnd.getTime() + DAY_MS;
        const gap = s.periodStart
            ? s.periodStart.getTime() - expected > GAP_TOLERANCE_DAYS * DAY_MS
            : !!s.periodEnd &&
                s.periodEnd.getTime() - prevEnd.getTime() > MONTH_DAYS * DAY_MS;
        if (gap)
            return {
                kind: 'MISSING',
                previousStatementId: previous.id,
                from: isoDay(new Date(expected)),
                to: s.periodStart
                    ? isoDay(new Date(s.periodStart.getTime() - DAY_MS))
                    : null,
                previousClosing,
                opening: s.openingBalance,
            };
    }
    return {
        kind: 'MISMATCH',
        previousStatementId: previous.id,
        previousEnd: prevEnd ? isoDay(prevEnd) : null,
        previousClosing,
        opening: s.openingBalance ?? 0,
    };
}
function workedOutOpening(s) {
    if (s.closingBalance === null)
        return null;
    const card = (0, exports.isCreditCard)(s.accountKind);
    const opening = (0, reconcile_util_1.cents)(s.closingBalance) + (card ? 1 : -1) * (0, reconcile_util_1.cents)(s.net);
    if (opening === 0)
        return null;
    return ((card ? -1 : 1) * opening) / 100;
}
function reviewReason(bridge) {
    return {
        kind: 'REVIEW',
        previousStatementId: bridge.id,
        previousEnd: bridge.periodEnd ? isoDay(bridge.periodEnd) : null,
    };
}
function silentBreak(previous, s, endings) {
    const reason = breakReason(previous, s);
    if (reason.kind === 'MISSING')
        return reason;
    if (s.openingBalance === null || !endings.length || endings.includes(0))
        return null;
    return reason;
}
function startsByAccount(rows) {
    const out = new Map();
    for (const r of rows) {
        const list = out.get(r.bankAccount) ?? [];
        const day = r.postingDate ?? r.periodEnd;
        list.push({
            statementId: r.statementId,
            date: day ? isoDay(day) : null,
            amount: r.amount,
            ...(r.derived && { derived: r.derived }),
            ...(r.reason && { reason: r.reason }),
        });
        out.set(r.bankAccount, list);
    }
    for (const list of out.values())
        list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    return out;
}
exports.CREDIT_CARD = 'CREDIT_CARD';
const isCreditCard = (kind) => kind === exports.CREDIT_CARD;
exports.isCreditCard = isCreditCard;
function endingsOf(s, openings = []) {
    const out = [];
    if (s.closingBalance !== null)
        out.push((0, reconcile_util_1.cents)(s.closingBalance));
    const net = (0, reconcile_util_1.cents)(s.net);
    const opens = s.openingBalance !== null ? [(0, reconcile_util_1.cents)(s.openingBalance)] : openings;
    for (const open of opens)
        out.push(open + net, open - net);
    return [...new Set(out.flatMap((c) => [c, -c]))];
}
const MAX_CARRIED = 64;
const num = (d) => d === null ? null : Number(d);
exports.num = num;
exports.OPENING_STATEMENT_SELECT = {
    id: true,
    accountName: true,
    accountKind: true,
    currency: true,
    bankName: true,
    filename: true,
    openingBalance: true,
    closingBalance: true,
    periodStart: true,
    periodEnd: true,
};
exports.OPENING_POSITION = -1;
function ledgerOrder(a, b) {
    const t = (d) => d?.getTime() ?? -Infinity;
    const ta = t(a.postingDate);
    const tb = t(b.postingDate);
    if (ta !== tb)
        return ta < tb ? -1 : 1;
    return a.statementId - b.statementId || a.position - b.position;
}
//# sourceMappingURL=opening-balance.util.js.map