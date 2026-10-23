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
var FeatureRequestsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeatureRequestsService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const answer_html_1 = require("../mail/answer-html");
const customer_messenger_service_1 = require("../messaging/customer-messenger.service");
const prisma_service_1 = require("../prisma/prisma.service");
const schedules_service_1 = require("../schedules/schedules.service");
const feature_requests_store_1 = require("./feature-requests.store");
const BATCH = 20;
let FeatureRequestsService = FeatureRequestsService_1 = class FeatureRequestsService {
    prisma;
    messenger;
    schedules;
    logger = new common_1.Logger(FeatureRequestsService_1.name);
    ticking = false;
    constructor(prisma, messenger, schedules) {
        this.prisma = prisma;
        this.messenger = messenger;
        this.schedules = schedules;
    }
    async listForCustomer(customerId) {
        const rows = await this.prisma.featureRequest.findMany({
            where: { customerId },
            orderBy: { id: 'desc' },
            take: 200,
        });
        const bookIds = [
            ...new Set(rows.map((r) => r.bookId).filter((id) => id !== null)),
        ];
        const books = bookIds.length
            ? await this.prisma.book.findMany({
                where: { id: { in: bookIds }, customerId },
                select: { id: true, name: true },
            })
            : [];
        const bookName = new Map(books.map((b) => [b.id, b.name]));
        return rows.map((r) => ({
            id: r.id,
            summary: r.summary,
            request: r.request,
            status: r.status,
            staffNote: r.staffNote,
            channel: r.channel,
            book: r.bookId !== null ? (bookName.get(r.bookId) ?? null) : null,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
            doneAt: r.doneAt?.toISOString() ?? null,
        }));
    }
    async tick() {
        if (this.ticking)
            return;
        this.ticking = true;
        try {
            const due = await this.prisma.featureRequest.findMany({
                where: { status: 'DONE', notifiedAt: null, notifyError: null },
                orderBy: { id: 'asc' },
                take: BATCH,
            });
            for (const r of due) {
                const claimed = await this.prisma.featureRequest.updateMany({
                    where: { id: r.id, status: 'DONE', notifiedAt: null },
                    data: { notifiedAt: new Date() },
                });
                if (!claimed.count)
                    continue;
                const error = await this.notify(r).catch((err) => err instanceof Error ? err.message : String(err));
                if (error) {
                    this.logger.warn(`feature request #${r.id} not sent: ${error}`);
                    await this.prisma.featureRequest.update({
                        where: { id: r.id },
                        data: { notifyError: error.slice(0, 512) },
                    });
                }
                else {
                    this.logger.log(`feature request #${r.id}: customer told it is done`);
                }
            }
        }
        catch (err) {
            this.logger.error(`feature request tick failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            this.ticking = false;
        }
    }
    async notify(r) {
        const customer = await this.prisma.customer.findFirst({
            where: { id: r.customerId, deletedAt: null },
            select: { id: true },
        });
        if (!customer)
            return 'The customer account no longer exists.';
        const conversation = r.conversationId
            ? await this.prisma.aiConversation.findUnique({
                where: { id: r.conversationId },
                select: { channel: true, peer: true },
            })
            : null;
        const target = (0, feature_requests_store_1.doneTarget)({
            channel: conversation?.channel ?? 'BOT',
            peer: conversation?.peer ?? null,
        }, this.messenger.smsConfigured, await this.schedules.delivery(r.customerId, true));
        if (!target)
            return 'No email address or phone number to send to.';
        const text = (0, feature_requests_store_1.featureDoneText)(r.summary, r.staffNote);
        if (target.channel === 'SMS') {
            const outcome = await this.messenger.send({
                channel: 'SMS',
                to: target.to,
                body: text,
                meta: {
                    customerId: r.customerId,
                    bookId: r.bookId,
                    companyId: r.companyId,
                    purpose: 'FEATURE_DONE',
                },
            });
            if (outcome !== 'sent')
                return `The text was not sent (${outcome}).`;
            if (r.bookId !== null) {
                await this.schedules.logText({
                    customerId: r.customerId,
                    bookId: r.bookId,
                    companyId: r.companyId,
                }, target.to, text);
            }
            return null;
        }
        return this.schedules.email(target.to, {
            subject: 'What you asked for is now available',
            text,
            html: (0, answer_html_1.answerHtml)(text),
            attachments: [],
        });
    }
};
exports.FeatureRequestsService = FeatureRequestsService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_MINUTE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], FeatureRequestsService.prototype, "tick", null);
exports.FeatureRequestsService = FeatureRequestsService = FeatureRequestsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        customer_messenger_service_1.CustomerMessenger,
        schedules_service_1.SchedulesService])
], FeatureRequestsService);
//# sourceMappingURL=feature-requests.service.js.map