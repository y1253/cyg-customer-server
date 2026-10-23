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
var CustomerOutbox_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerOutbox = exports.OUTBOX_CHANNELS = void 0;
const common_1 = require("@nestjs/common");
const answer_html_1 = require("../mail/answer-html");
const mail_service_1 = require("../mail/mail.service");
const customer_messenger_service_1 = require("../messaging/customer-messenger.service");
const prisma_service_1 = require("../prisma/prisma.service");
exports.OUTBOX_CHANNELS = [
    'SMS',
    'WHATSAPP',
    'EMAIL',
];
const LABEL = {
    SMS: 'text',
    WHATSAPP: 'WhatsApp',
    EMAIL: 'email',
};
let CustomerOutbox = CustomerOutbox_1 = class CustomerOutbox {
    prisma;
    messenger;
    mail;
    logger = new common_1.Logger(CustomerOutbox_1.name);
    constructor(prisma, messenger, mail) {
        this.prisma = prisma;
        this.messenger = messenger;
        this.mail = mail;
    }
    async send(scope, channel, text, subject) {
        const body = text.trim();
        if (!body)
            return { ok: false, error: 'There was nothing to send.' };
        const c = await this.prisma.customer.findFirst({
            where: { id: scope.customerId, deletedAt: null },
            select: { email: true, phoneE164: true },
        });
        if (!c)
            return { ok: false, error: 'The account was not found.' };
        if (channel === 'EMAIL') {
            if (!c.email)
                return {
                    ok: false,
                    error: 'There is no email address on the account.',
                };
            try {
                await this.mail.send({
                    to: c.email,
                    subject: subject?.trim().slice(0, 150) || 'From your CYG Finance assistant',
                    text: body,
                    html: (0, answer_html_1.answerHtml)(body),
                    fromName: 'CYG Finance',
                });
            }
            catch (err) {
                this.logger.warn(`assistant email FAILED: ${err instanceof Error ? err.message : String(err)}`);
                return {
                    ok: false,
                    error: 'The email could not be sent right now. Offer a text instead.',
                };
            }
            await this.log(scope, 'EMAIL', c.email.toLowerCase(), body);
            return { ok: true, to: c.email };
        }
        const to = channel === 'WHATSAPP'
            ? ((await this.lastPeer(scope.customerId, 'WHATSAPP')) ?? c.phoneE164)
            : c.phoneE164;
        if (!to)
            return { ok: false, error: 'There is no phone number on the account.' };
        const outcome = await this.messenger.send({ channel, to, body });
        if (outcome !== 'sent') {
            return {
                ok: false,
                error: channel === 'WHATSAPP' && outcome === 'failed'
                    ? 'The WhatsApp was not delivered — WhatsApp only lets us write within 24 hours of their last WhatsApp to us. Offer a text or an email instead.'
                    : `The ${LABEL[channel]} was not sent (${outcome}).`,
            };
        }
        await this.log(scope, channel, to, body);
        return { ok: true, to };
    }
    async lastPeer(customerId, channel) {
        const row = await this.prisma.aiConversation.findFirst({
            where: { customerId, channel, peer: { not: null }, attachmentId: null },
            orderBy: { lastMessageAt: 'desc' },
            select: { peer: true },
        });
        return row?.peer ?? null;
    }
    async log(scope, channel, peer, text) {
        try {
            const conversation = (await this.prisma.aiConversation.findFirst({
                where: {
                    customerId: scope.customerId,
                    channel,
                    peer,
                    attachmentId: null,
                },
                orderBy: { id: 'desc' },
            })) ??
                (await this.prisma.aiConversation.create({
                    data: {
                        customerId: scope.customerId,
                        companyId: scope.companyId,
                        channel,
                        peer,
                        bookChosen: true,
                    },
                }));
            await this.prisma.$transaction([
                this.prisma.aiMessage.create({
                    data: {
                        conversationId: conversation.id,
                        customerId: conversation.customerId,
                        companyId: conversation.companyId,
                        channel,
                        role: 'ASSISTANT',
                        text: text.slice(0, 20_000),
                    },
                }),
                this.prisma.aiConversation.update({
                    where: { id: conversation.id },
                    data: { lastMessageAt: new Date() },
                }),
            ]);
        }
        catch (err) {
            this.logger.warn(`sent ${channel} not logged: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
};
exports.CustomerOutbox = CustomerOutbox;
exports.CustomerOutbox = CustomerOutbox = CustomerOutbox_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        customer_messenger_service_1.CustomerMessenger,
        mail_service_1.MailService])
], CustomerOutbox);
//# sourceMappingURL=customer-outbox.service.js.map