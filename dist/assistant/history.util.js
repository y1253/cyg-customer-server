"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTHER_CHANNELS = exports.CHANNEL_LABEL = void 0;
exports.doneOf = doneOf;
exports.linksOf = linksOf;
exports.whenLabel = whenLabel;
exports.historyLine = historyLine;
exports.otherChannelsBlock = otherChannelsBlock;
exports.searchHit = searchHit;
const next_run_util_1 = require("../schedules/next-run.util");
exports.CHANNEL_LABEL = {
    BOT: 'Website chat',
    SMS: 'Text',
    WHATSAPP: 'WhatsApp',
    EMAIL: 'Email',
    VOICE: 'Phone call',
};
exports.OTHER_CHANNELS = {
    hours: 72,
    maxRows: 12,
    maxLine: 300,
    maxChars: 3000,
};
const actionsOf = (raw) => Array.isArray(raw)
    ? raw.filter((a) => !!a && typeof a === 'object')
    : [];
function doneOf(raw) {
    return actionsOf(raw)
        .filter((a) => a.ok === true && typeof a.summary === 'string')
        .map((a) => a.summary);
}
function linksOf(raw) {
    return actionsOf(raw)
        .filter((a) => a.ok === true &&
        a.tool === 'get_link' &&
        !!a.ref &&
        typeof a.ref === 'object' &&
        typeof a.ref.type === 'string')
        .map((a) => a.ref);
}
const cut = (text, max) => {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
function whenLabel(at, tz = next_run_util_1.DEFAULT_TIMEZONE) {
    return at.toLocaleString('en-US', {
        timeZone: tz,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}
function historyLine(r, opts, maxLine = exports.OTHER_CHANNELS.maxLine) {
    const head = [
        exports.CHANNEL_LABEL[r.channel] ?? r.channel,
        whenLabel(r.createdAt),
        r.role === 'USER' ? 'customer' : 'you',
        ...(r.bookId !== opts.currentBookId
            ? [opts.bookName(r.bookId)]
            : []),
    ].join(' · ');
    const files = r.files.length
        ? ` (files: ${r.files
            .map((f) => `#${f.attachmentId} "${f.filename}"${f.removed ? ' removed' : ''}`)
            .join(', ')})`
        : '';
    const done = doneOf(r.actions);
    const did = done.length ? ` [Done: ${cut(done.join('; '), 200)}]` : '';
    return `[${head}] ${cut(r.text, maxLine)}${files}${did}`;
}
function otherChannelsBlock(rows, opts) {
    const since = opts.now.getTime() - exports.OTHER_CHANNELS.hours * 3600_000;
    const recent = rows
        .filter((r) => r.createdAt.getTime() >= since && r.text.trim())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, exports.OTHER_CHANNELS.maxRows);
    const lines = [];
    let used = 0;
    for (const r of recent) {
        const line = historyLine(r, opts);
        if (used + line.length > exports.OTHER_CHANNELS.maxChars)
            break;
        lines.push(line);
        used += line.length + 1;
    }
    if (!lines.length)
        return null;
    return ("RECENT ON THE CUSTOMER'S OTHER CHANNELS (the same customer, talking to you elsewhere; " +
        'oldest first). Use it when they refer to something said or sent there ("the docs I ' +
        'told you about on the phone"). For anything older or not here, call search_communications.\n' +
        lines.reverse().join('\n'));
}
function searchHit(r, bookName) {
    return {
        messageId: r.id,
        at: r.createdAt.toISOString(),
        when: whenLabel(r.createdAt),
        channel: exports.CHANNEL_LABEL[r.channel] ?? r.channel,
        book: bookName(r.bookId),
        who: r.role === 'USER' ? 'customer' : 'assistant',
        text: cut(r.text, 600),
        ...(r.files.length ? { files: r.files } : {}),
        ...(linksOf(r.actions).length ? { linksSent: linksOf(r.actions) } : {}),
        ...(doneOf(r.actions).length ? { done: doneOf(r.actions) } : {}),
    };
}
//# sourceMappingURL=history.util.js.map