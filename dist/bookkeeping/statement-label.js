"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statementLabel = statementLabel;
const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
];
function statementLabel(s) {
    const name = s.accountName ?? s.bankName ?? s.filename;
    const a = s.periodStart;
    const b = s.periodEnd ?? s.periodStart;
    if (!a || !b)
        return name;
    const mon = (d) => MONTHS[d.getUTCMonth()];
    const sameMonth = a.getUTCFullYear() === b.getUTCFullYear() &&
        a.getUTCMonth() === b.getUTCMonth();
    if (sameMonth)
        return `${name} · ${mon(a)} ${a.getUTCFullYear()}`;
    const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
    const range = sameYear
        ? `${mon(a)} ${a.getUTCDate()} – ${mon(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`
        : `${mon(a)} ${a.getUTCDate()}, ${a.getUTCFullYear()} – ${mon(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
    return `${name} · ${range}`;
}
//# sourceMappingURL=statement-label.js.map