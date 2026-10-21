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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunicationsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const communications_util_1 = require("./communications.util");
const scope_1 = require("./scope");
const voice_calls_service_1 = require("../voice/voice-calls.service");
const ATTACHMENT_FIELDS = {
    id: true,
    filename: true,
    mimeType: true,
    status: true,
    message: true,
    createdAt: true,
    deletedAt: true,
};
const shown = (a) => a.deletedAt ? { ...a, status: 'REMOVED' } : a;
let CommunicationsService = class CommunicationsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async channels(scope) {
        return Promise.all(communications_util_1.COMM_CHANNELS.map(async (channel) => {
            const [count, newest] = await Promise.all([
                this.count(scope, channel),
                this.page(scope, channel, null, 1),
            ]);
            return {
                channel,
                count,
                lastAt: newest.items[0]?.at ?? null,
                preview: (0, communications_util_1.previewOf)(newest.items[0]),
            };
        }));
    }
    async page(scope, channel, before, limit = 50) {
        const book = (0, scope_1.scopeWhere)(scope);
        const older = before ? { createdAt: { lt: before } } : {};
        const take = limit + 1;
        if (channel === 'UPLOADS') {
            const [loose, statements] = await Promise.all([
                this.prisma.transactionAttachment.findMany({
                    where: { ...book, ...older, deletedAt: null, source: 'UPLOAD' },
                    orderBy: { createdAt: 'desc' },
                    take,
                    select: ATTACHMENT_FIELDS,
                }),
                this.prisma.bankStatement.findMany({
                    where: { ...book, ...older, deletedAt: null, source: 'UPLOAD' },
                    orderBy: { createdAt: 'desc' },
                    take,
                    select: { id: true, filename: true, status: true, createdAt: true },
                }),
            ]);
            return (0, communications_util_1.pageOf)((0, communications_util_1.buildTimeline)({ messages: [], files: new Map(), loose, statements }), limit);
        }
        const source = communications_util_1.FILE_SOURCE[channel];
        const [found, referenced] = await Promise.all([
            this.prisma.aiMessage.findMany({
                where: { ...book, ...older, channel },
                orderBy: { createdAt: 'desc' },
                take,
                select: {
                    id: true,
                    role: true,
                    text: true,
                    warning: true,
                    attachmentIds: true,
                    createdAt: true,
                },
            }),
            source ? this.referencedIds(scope, channel) : Promise.resolve([]),
        ]);
        const links = found.length
            ? await this.prisma.aiMessageAttachment.findMany({
                where: { messageId: { in: found.map((m) => m.id) } },
                select: { messageId: true, attachmentId: true },
                orderBy: { id: 'asc' },
            })
            : [];
        const messages = found.map((m) => ({
            ...m,
            attachmentIds: [
                ...new Set([
                    ...(0, communications_util_1.idsOf)(m.attachmentIds),
                    ...links
                        .filter((l) => l.messageId === m.id)
                        .map((l) => l.attachmentId),
                ]),
            ],
        }));
        const calls = channel === 'VOICE'
            ? (await this.prisma.aiCall.findMany({
                where: {
                    ...book,
                    ...(before ? { startedAt: { lt: before } } : {}),
                },
                orderBy: { startedAt: 'desc' },
                take,
            })).map((c) => ({ ...(0, voice_calls_service_1.toCallView)(c), startedAt: c.startedAt }))
            : [];
        const [carried, loose] = await Promise.all([
            this.prisma.transactionAttachment.findMany({
                where: {
                    customerId: scope.customerId,
                    id: { in: messages.flatMap((m) => m.attachmentIds) },
                },
                select: ATTACHMENT_FIELDS,
            }),
            source
                ? this.prisma.transactionAttachment.findMany({
                    where: {
                        ...book,
                        ...older,
                        deletedAt: null,
                        source,
                        ...(referenced.length && { id: { notIn: referenced } }),
                    },
                    orderBy: { createdAt: 'desc' },
                    take,
                    select: ATTACHMENT_FIELDS,
                })
                : Promise.resolve([]),
        ]);
        return (0, communications_util_1.pageOf)((0, communications_util_1.buildTimeline)({
            messages,
            files: new Map(carried.map((a) => [a.id, shown(a)])),
            loose,
            statements: [],
            calls,
        }), limit);
    }
    async count(scope, channel) {
        const book = (0, scope_1.scopeWhere)(scope);
        if (channel === 'UPLOADS') {
            const [a, s] = await Promise.all([
                this.prisma.transactionAttachment.count({
                    where: { ...book, deletedAt: null, source: 'UPLOAD' },
                }),
                this.prisma.bankStatement.count({
                    where: { ...book, deletedAt: null, source: 'UPLOAD' },
                }),
            ]);
            return a + s;
        }
        const source = communications_util_1.FILE_SOURCE[channel];
        const [messages, files, calls] = await Promise.all([
            this.prisma.aiMessage.count({ where: { ...book, channel } }),
            source
                ? this.prisma.transactionAttachment.count({
                    where: { ...book, deletedAt: null, source },
                })
                : Promise.resolve(0),
            channel === 'VOICE'
                ? this.prisma.aiCall.count({ where: book })
                : Promise.resolve(0),
        ]);
        return messages + files + calls;
    }
    async referencedIds(scope, channel) {
        const [rows, links] = await Promise.all([
            this.prisma.aiMessage.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), channel, role: 'USER' },
                select: { attachmentIds: true },
            }),
            this.prisma.aiMessageAttachment.findMany({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    role: 'SENT',
                    message: { channel, role: 'USER' },
                },
                select: { attachmentId: true },
            }),
        ]);
        return [
            ...new Set([
                ...rows.flatMap((r) => (0, communications_util_1.idsOf)(r.attachmentIds)),
                ...links.map((l) => l.attachmentId),
            ]),
        ];
    }
};
exports.CommunicationsService = CommunicationsService;
exports.CommunicationsService = CommunicationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CommunicationsService);
//# sourceMappingURL=communications.service.js.map