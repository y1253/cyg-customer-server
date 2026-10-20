"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILE_SOURCE = exports.MESSAGE_CHANNELS = exports.isCommChannel = exports.COMM_CHANNELS = void 0;
exports.idsOf = idsOf;
exports.buildTimeline = buildTimeline;
exports.pageOf = pageOf;
exports.previewOf = previewOf;
exports.COMM_CHANNELS = [
    'WHATSAPP',
    'SMS',
    'EMAIL',
    'BOT',
    'UPLOADS',
];
const isCommChannel = (c) => typeof c === 'string' && exports.COMM_CHANNELS.includes(c);
exports.isCommChannel = isCommChannel;
exports.MESSAGE_CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL', 'BOT'];
exports.FILE_SOURCE = {
    WHATSAPP: 'WHATSAPP',
    SMS: 'SMS',
    EMAIL: 'EMAIL',
};
function idsOf(json) {
    return Array.isArray(json)
        ? json.filter((n) => Number.isInteger(n) && n > 0)
        : [];
}
const FILE_LABEL = /^\[sent (a file|\d+ files)\]$/;
const fileOf = (a) => ({
    type: 'attachment',
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    status: a.status,
});
function buildTimeline(input) {
    const items = [
        ...input.messages.map((m) => {
            const files = idsOf(m.attachmentIds)
                .map((id) => input.files.get(id))
                .filter((a) => !!a)
                .map(fileOf);
            return {
                key: `m:${m.id}`,
                at: m.createdAt.toISOString(),
                side: m.role === 'USER' ? 'customer' : 'cyg',
                kind: 'message',
                text: files.length && FILE_LABEL.test(m.text) ? null : m.text,
                files,
                ...(m.warning && { warning: m.warning }),
            };
        }),
        ...input.loose.map((a) => ({
            key: `a:${a.id}`,
            at: a.createdAt.toISOString(),
            side: 'customer',
            kind: 'upload',
            text: a.message?.trim() || null,
            files: [fileOf(a)],
        })),
        ...input.statements.map((s) => ({
            key: `s:${s.id}`,
            at: s.createdAt.toISOString(),
            side: 'customer',
            kind: 'upload',
            text: null,
            files: [
                {
                    type: 'statement',
                    id: s.id,
                    filename: s.filename,
                    mimeType: 'application/pdf',
                    status: s.status,
                },
            ],
        })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key));
}
function pageOf(items, limit) {
    const page = items.slice(0, limit);
    return {
        items: page,
        nextBefore: items.length > limit ? page[page.length - 1].at : null,
    };
}
function previewOf(item) {
    if (!item)
        return null;
    const who = item.side === 'cyg' ? 'CYG: ' : '';
    if (item.text)
        return `${who}${item.text.replace(/\s+/g, ' ').slice(0, 120)}`;
    const f = item.files[0];
    if (!f)
        return null;
    const more = item.files.length > 1 ? ` +${item.files.length - 1}` : '';
    return `${who}📎 ${f.filename}${more}`;
}
//# sourceMappingURL=communications.util.js.map