"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nothingOpen = void 0;
exports.statusLines = statusLines;
exports.accountStatusMessage = accountStatusMessage;
exports.financialReportMessage = financialReportMessage;
const nothingOpen = (s) => !s.unmatchedFiles &&
    !s.newDocuments &&
    !s.uncategorized &&
    !s.unrecognizedNames &&
    !s.statementsToReview &&
    !s.statementsWaiting;
exports.nothingOpen = nothingOpen;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function statusLines(s) {
    const lines = [];
    if (s.statementsToReview)
        lines.push(`${plural(s.statementsToReview, 'statement', 'statements')} we couldn't read or that need a look`);
    if (s.statementsWaiting)
        lines.push(`${plural(s.statementsWaiting, 'statement is', 'statements are')} uploaded but not generated yet`);
    if (s.unmatchedFiles)
        lines.push(`${plural(s.unmatchedFiles, 'attachment', 'attachments')} (receipts, cheques…) not matched to a transaction yet`);
    if (s.uncategorized)
        lines.push(`${plural(s.uncategorized, 'transaction is', 'transactions are')} still Uncategorized`);
    if (s.unrecognizedNames)
        lines.push(`${plural(s.unrecognizedNames, 'description has', 'descriptions have')} no recognized payee name`);
    if (s.newDocuments)
        lines.push(`${plural(s.newDocuments, 'document', 'documents')} (letters, requests) you sent us`);
    return lines;
}
const esc = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
function accountStatusMessage(input) {
    const lines = statusLines(input.status);
    const hi = `Hi ${input.firstName || 'there'},`;
    if (input.sms) {
        const text = [
            `${hi} your weekly account status (${input.book}):`,
            ...lines.map((l) => `• ${l}`),
            'Reply here and I’ll help you sort them out, or open:',
            input.link,
        ].join('\n');
        return { subject: '', text, html: '' };
    }
    const subject = `Your account status — ${lines.length} item${lines.length === 1 ? '' : 's'} to review (${input.book})`;
    const text = [
        hi,
        '',
        `Here is this week's account status for ${input.book}:`,
        '',
        ...lines.map((l) => `• ${l}`),
        '',
        'Reply to this email, text us, or ask the assistant on the website and we’ll help you sort them out.',
        `Open your books: ${input.link}`,
        '',
        '— CYG Finance',
    ].join('\n');
    const html = `<p>${esc(hi)}</p><p>Here is this week's account status for <b>${esc(input.book)}</b>:</p><ul>${lines
        .map((l) => `<li>${esc(l)}</li>`)
        .join('')}</ul><p>Reply to this email, text us, or ask the assistant on the website and we’ll help you sort them out.</p><p><a href="${esc(input.link)}">Open your books</a></p><p>— CYG Finance</p>`;
    return { subject, text, html };
}
const MONEY = (n) => n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
});
function financialReportMessage(input) {
    const hi = `Hi ${input.firstName || 'there'},`;
    const figures = `Income ${MONEY(input.income)}, expenses ${MONEY(input.expenses)}, ${input.net >= 0 ? 'net income' : 'net loss'} ${MONEY(Math.abs(input.net))}.`;
    const caveat = input.uncategorized
        ? ` ${plural(input.uncategorized, 'transaction is', 'transactions are')} still Uncategorized, so it is not final.`
        : '';
    if (input.sms) {
        return {
            subject: '',
            text: `${hi} your financial report for ${input.period} (${input.book}): ${figures}${caveat}\nFull report: ${input.link}`,
            html: '',
        };
    }
    const subject = `Your financial report — ${input.period} (${input.book})`;
    const text = [
        hi,
        '',
        `Your financial report for ${input.period} (${input.book}) is attached.`,
        '',
        figures + caveat,
        '',
        `You can also open it here (the link works for 7 days): ${input.link}`,
        '',
        '— CYG Finance',
    ].join('\n');
    const html = `<p>${esc(hi)}</p><p>Your financial report for <b>${esc(input.period)}</b> (${esc(input.book)}) is attached.</p><p>${esc(figures + caveat)}</p><p><a href="${esc(input.link)}">Open the report</a> (the link works for 7 days)</p><p>— CYG Finance</p>`;
    return { subject, text, html };
}
//# sourceMappingURL=schedule-messages.util.js.map