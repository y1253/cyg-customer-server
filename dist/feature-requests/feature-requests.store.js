"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TYPED_WINDOW_MS = exports.TYPED_PER_DAY = exports.REQUEST_MAX = exports.SUMMARY_MAX = exports.DEDUPE_MS = exports.FEATURE_STATUSES = void 0;
exports.cleanSummary = cleanSummary;
exports.featureDoneText = featureDoneText;
exports.saveFeatureRequest = saveFeatureRequest;
exports.saveTypedRequest = saveTypedRequest;
exports.doneTarget = doneTarget;
exports.FEATURE_STATUSES = [
    'OPEN',
    'PLANNED',
    'DONE',
    'DECLINED',
];
exports.DEDUPE_MS = 10 * 60_000;
exports.SUMMARY_MAX = 200;
exports.REQUEST_MAX = 4_000;
function cleanSummary(raw) {
    const one = raw.replace(/\s+/g, ' ').trim();
    return one.length > exports.SUMMARY_MAX ? `${one.slice(0, exports.SUMMARY_MAX - 1)}…` : one;
}
function featureDoneText(summary, note) {
    const extra = note?.trim();
    return `Good news from CYG Finance — what you asked for is now available: ${summary}.${extra ? ` ${extra}` : ''}`;
}
async function saveFeatureRequest(prisma, input, now = new Date()) {
    if (input.conversationId !== null) {
        const recent = await prisma.featureRequest.findFirst({
            where: {
                customerId: input.scope.customerId,
                conversationId: input.conversationId,
                status: 'OPEN',
                createdAt: { gte: new Date(now.getTime() - exports.DEDUPE_MS) },
            },
            orderBy: { id: 'desc' },
            select: { id: true, summary: true },
        });
        if (recent)
            return recent;
    }
    return prisma.featureRequest.create({
        data: {
            customerId: input.scope.customerId,
            bookId: input.scope.bookId,
            companyId: input.scope.companyId,
            conversationId: input.conversationId,
            messageId: input.messageId,
            channel: input.channel.slice(0, 12),
            request: input.request.trim().slice(0, exports.REQUEST_MAX),
            summary: cleanSummary(input.summary) || cleanSummary(input.request),
        },
        select: { id: true, summary: true },
    });
}
exports.TYPED_PER_DAY = 10;
exports.TYPED_WINDOW_MS = 24 * 60 * 60_000;
async function saveTypedRequest(prisma, customerId, input, now = new Date()) {
    const recent = await prisma.featureRequest.count({
        where: {
            customerId,
            channel: 'FORM',
            createdAt: { gte: new Date(now.getTime() - exports.TYPED_WINDOW_MS) },
        },
    });
    if (recent >= exports.TYPED_PER_DAY)
        return null;
    const summary = cleanSummary(input.summary);
    return prisma.featureRequest.create({
        data: {
            customerId,
            channel: 'FORM',
            request: (input.request?.trim() || summary).slice(0, exports.REQUEST_MAX),
            summary,
        },
    });
}
function doneTarget(origin, smsConfigured, preferred) {
    if (origin.channel === 'SMS' && origin.peer && smsConfigured)
        return { channel: 'SMS', to: origin.peer };
    if ((preferred.channel === 'SMS' || preferred.channel === 'EMAIL') &&
        preferred.to)
        return { channel: preferred.channel, to: preferred.to };
    return null;
}
//# sourceMappingURL=feature-requests.store.js.map