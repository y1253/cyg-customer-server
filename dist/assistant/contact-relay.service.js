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
var ContactRelayService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactRelayService = void 0;
const common_1 = require("@nestjs/common");
const ai_contacts_service_1 = require("../ai-contacts/ai-contacts.service");
const books_1 = require("../bookkeeping/books");
const prisma_service_1 = require("../prisma/prisma.service");
const customer_outbox_service_1 = require("./customer-outbox.service");
let ContactRelayService = ContactRelayService_1 = class ContactRelayService {
    prisma;
    outbox;
    logger = new common_1.Logger(ContactRelayService_1.name);
    constructor(prisma, outbox) {
        this.prisma = prisma;
        this.outbox = outbox;
    }
    async relay(input) {
        const contact = await this.prisma.aiContact.findFirst({
            where: {
                phoneE164: input.phone,
                deletedAt: null,
                lastContactedAt: {
                    gte: new Date(Date.now() - ai_contacts_service_1.CONTACT_REPLY_WINDOW_MS),
                },
                customer: { deletedAt: null },
            },
            orderBy: { lastContactedAt: 'desc' },
            include: {
                customer: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phoneE164: true,
                        preferredContact: true,
                    },
                },
            },
        });
        if (!contact)
            return { handled: false };
        const words = input.text?.trim();
        const text = input.channel === 'CALL'
            ? `${contact.name} (${input.phone}) called back. You can ask me to call or text them.`
            : words
                ? `${contact.name} replied: "${words.slice(0, 1500)}"`
                : `${contact.name} (${input.phone}) sent a message with no text.`;
        const c = contact.customer;
        const preferred = c.preferredContact;
        const order = [
            ...(preferred === 'EMAIL' ||
                preferred === 'WHATSAPP' ||
                preferred === 'SMS'
                ? [preferred]
                : []),
            ...(c.phoneE164 ? ['SMS'] : []),
            ...(c.email ? ['EMAIL'] : []),
        ];
        const scope = await (0, books_1.ensureDefaultBook)(this.prisma, c.id);
        for (const channel of [...new Set(order)]) {
            const sent = await this.outbox.send(scope, channel, text);
            if (sent.ok) {
                this.logger.log(`contact #${contact.id} ${input.channel} relayed to customer #${c.id} by ${channel}`);
                return { handled: true, customerName: c.name.trim() || 'our client' };
            }
        }
        this.logger.warn(`contact #${contact.id} reply NOT relayed to customer #${c.id} (no channel worked)`);
        return { handled: true, customerName: c.name.trim() || 'our client' };
    }
};
exports.ContactRelayService = ContactRelayService;
exports.ContactRelayService = ContactRelayService = ContactRelayService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        customer_outbox_service_1.CustomerOutbox])
], ContactRelayService);
//# sourceMappingURL=contact-relay.service.js.map