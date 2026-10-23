"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var CommunicationsHistory_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunicationsHistory = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const history_util_1 = require("./history.util");
const CHANNELS = Object.keys(history_util_1.CHANNEL_LABEL);
let CommunicationsHistory = CommunicationsHistory_1 = class CommunicationsHistory {
    prisma;
    logger = new common_1.Logger(CommunicationsHistory_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async otherChannels(conversation) {
        try {
            const since = new Date(Date.now() - history_util_1.OTHER_CHANNELS.hours * 3600_000);
            const rows = await this.rows({
                customerId: conversation.customerId,
                conversationId: { not: conversation.id },
                createdAt: { gte: since },
                conversation: { attachmentId: null },
            }, history_util_1.OTHER_CHANNELS.maxRows);
            if (!rows.length)
                return null;
            return (0, history_util_1.otherChannelsBlock)(rows, {
                now: new Date(),
                currentCompanyId: conversation.companyId,
                bookName: await this.bookNames(conversation.customerId),
            });
        }
        catch (err) {
            this.logger.warn(`other channels not loaded: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }
    async recentTurns(conversationId, take) {
        try {
            const rows = await this.prisma.aiMessage.findMany({
                where: { conversationId },
                orderBy: { id: 'desc' },
                take,
                select: { role: true, text: true, createdAt: true },
            });
            if (!rows.length)
                return null;
            return rows
                .reverse()
                .map((r) => `[${(0, history_util_1.whenLabel)(r.createdAt)} · ${r.role === 'USER' ? 'caller' : 'you'}] ${r.text.replace(/\s+/g, ' ').slice(0, 300)}`)
                .join('\n');
        }
        catch {
            return null;
        }
    }
    async search(customerId, q) {
        const channel = q.channel?.toUpperCase() ?? null;
        if (channel && !CHANNELS.includes(channel)) {
            throw new Error(`channel must be one of ${CHANNELS.join(', ')}`);
        }
        const take = Math.min(Math.max(Math.trunc(q.limit ?? 15), 1), 30);
        const createdAt = {};
        if (q.from)
            createdAt.gte = new Date(`${q.from}T00:00:00Z`);
        if (q.to)
            createdAt.lt = new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000);
        const words = (q.query ?? '').trim();
        const rows = await this.rows({
            customerId,
            ...(channel ? { channel } : {}),
            ...(createdAt.gte || createdAt.lt ? { createdAt } : {}),
            ...(words ? { text: { contains: words } } : {}),
        }, take);
        const bookName = await this.bookNames(customerId);
        const out = {
            messages: rows.map((r) => (0, history_util_1.searchHit)(r, bookName)),
        };
        if (!channel || channel === 'VOICE') {
            const calls = await this.prisma.aiCall.findMany({
                where: {
                    customerId,
                    ...(createdAt.gte || createdAt.lt ? { startedAt: createdAt } : {}),
                },
                orderBy: { id: 'desc' },
                take: 10,
                select: {
                    direction: true,
                    purpose: true,
                    status: true,
                    startedAt: true,
                    durationSec: true,
                },
            });
            out.calls = calls.map((c) => ({
                when: (0, history_util_1.whenLabel)(c.startedAt),
                at: c.startedAt.toISOString(),
                direction: c.direction === 'OUTBOUND' ? 'we called them' : 'they called',
                purpose: c.purpose,
                status: c.status,
                minutes: c.durationSec ? Math.round(c.durationSec / 6) / 10 : null,
            }));
        }
        if (!rows.length) {
            out.note = words
                ? 'Nothing matched those words — try fewer or other words, or no query with a channel / dates.'
                : 'No messages in that range.';
        }
        return out;
    }
    async rows(where, take) {
        const messages = await this.prisma.aiMessage.findMany({
            where,
            orderBy: { id: 'desc' },
            take,
            select: {
                id: true,
                channel: true,
                role: true,
                text: true,
                createdAt: true,
                companyId: true,
                actions: true,
                attachmentLinks: { select: { attachmentId: true } },
            },
        });
        const ids = [
            ...new Set(messages.flatMap((m) => m.attachmentLinks.map((l) => l.attachmentId))),
        ];
        const files = ids.length
            ? await this.prisma.transactionAttachment.findMany({
                where: { id: { in: ids } },
                select: { id: true, filename: true, deletedAt: true },
            })
            : [];
        const byId = new Map(files.map((f) => [f.id, f]));
        return messages.map((m) => ({
            id: m.id,
            channel: m.channel,
            role: m.role,
            text: m.text,
            createdAt: m.createdAt,
            companyId: m.companyId,
            actions: m.actions,
            files: m.attachmentLinks.map((l) => {
                const f = byId.get(l.attachmentId);
                return {
                    attachmentId: l.attachmentId,
                    filename: f?.filename ?? 'file',
                    removed: !f || f.deletedAt !== null,
                };
            }),
        }));
    }
    async bookNames(customerId) {
        const companies = await this.prisma.company.findMany({
            where: { customerId, isInternal: false },
            select: { id: true, businessName: true },
        });
        const names = new Map(companies.map((c) => [c.id, c.businessName]));
        return (id) => id === null ? 'Personal books' : (names.get(id) ?? 'a deleted business');
    }
};
exports.CommunicationsHistory = CommunicationsHistory;
exports.CommunicationsHistory = CommunicationsHistory = CommunicationsHistory_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CommunicationsHistory);
//# sourceMappingURL=communications-history.service.js.map