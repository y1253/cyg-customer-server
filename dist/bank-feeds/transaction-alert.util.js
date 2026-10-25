"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALERT_EMAIL_SUBJECT = exports.ALERT_MAX_LINES = exports.ALERT_MAX_AGE_DAYS = void 0;
exports.alertChannel = alertChannel;
exports.recentEnough = recentEnough;
exports.alertText = alertText;
const chart_of_accounts_1 = require("../bookkeeping/chart-of-accounts");
exports.ALERT_MAX_AGE_DAYS = 7;
exports.ALERT_MAX_LINES = 10;
function alertChannel(c) {
    const canText = Boolean(c.phone) && c.smsConfigured;
    switch (c.preferred) {
        case 'EMAIL':
            return c.email ? 'EMAIL' : null;
        case 'WHATSAPP':
            return c.phone ? 'WHATSAPP' : null;
        case 'SMS':
        case 'CALL':
            return canText ? 'SMS' : null;
        default:
            return canText ? 'SMS' : c.email ? 'EMAIL' : null;
    }
}
function recentEnough(date, today) {
    const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`);
    return ms <= exports.ALERT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}
const money = (n) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
})}`;
const shortDate = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    });
};
function alertText(input) {
    const rows = [...input.rows].sort((a, b) => a.account.localeCompare(b.account) || a.date.localeCompare(b.date));
    const accounts = [...new Set(rows.map((r) => r.account))];
    const where = input.book ? ` (${input.book})` : '';
    const lines = [];
    let shown = 0;
    for (const account of accounts) {
        const mine = rows.filter((r) => r.account === account);
        const room = exports.ALERT_MAX_LINES - shown;
        if (room <= 0)
            break;
        const one = rows.length === 1;
        lines.push(`${one ? 'New transaction' : 'New transactions'} in ${account}${where}:`);
        for (const r of mine.slice(0, room)) {
            const category = r.category === chart_of_accounts_1.UNCATEGORIZED
                ? `${chart_of_accounts_1.UNCATEGORIZED} (reply with what it was)`
                : r.category;
            lines.push(`• ${shortDate(r.date)} · ${r.label} · ${money(r.amount)} → ${category}`);
            shown++;
        }
    }
    const more = rows.length - shown;
    if (more > 0)
        lines.push(`…and ${more} more on cygfinance.com`);
    lines.push(rows.length === 1
        ? 'Reply to change the category.'
        : 'Reply to change a category.');
    return lines.join('\n');
}
exports.ALERT_EMAIL_SUBJECT = 'New transactions in your books';
//# sourceMappingURL=transaction-alert.util.js.map