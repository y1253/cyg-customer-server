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
var CustomerMessenger_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerMessenger = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../prisma/prisma.service");
const messaging_util_1 = require("./messaging.util");
const TIMEOUT_MS = 20_000;
let CustomerMessenger = CustomerMessenger_1 = class CustomerMessenger {
    prisma;
    config;
    logger = new common_1.Logger(CustomerMessenger_1.name);
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
    }
    env(key) {
        return this.config.get(key)?.trim() || null;
    }
    get smsConfigured() {
        return !!(this.env('SIGNALWIRE_PROJECT_ID') &&
            this.env('SIGNALWIRE_API_TOKEN') &&
            this.env('SIGNALWIRE_SPACE_URL'));
    }
    get whatsappConfigured() {
        return !!this.env('WHATSAPP_TOKEN');
    }
    configured(channel) {
        return channel === 'SMS' ? this.smsConfigured : this.whatsappConfigured;
    }
    async send(input) {
        const to = (0, messaging_util_1.asE164)(input.to);
        if (!to || !input.body.trim())
            return 'failed';
        if (!this.configured(input.channel))
            return 'not-configured';
        try {
            if (input.channel === 'SMS') {
                if (await this.optedOut(to))
                    return 'opted-out';
                const from = (0, messaging_util_1.asE164)(input.from) ?? (await this.defaultSmsNumber());
                if (!from)
                    return 'not-configured';
                await this.sendSms(from, to, input.body);
            }
            else {
                const given = input.from?.trim() || null;
                const phoneNumberId = given && !given.startsWith('+')
                    ? given
                    : await this.whatsappIdFor(given);
                if (!phoneNumberId)
                    return 'not-configured';
                await this.sendWhatsApp(phoneNumberId, to, input.body);
            }
            return 'sent';
        }
        catch (err) {
            this.logger.warn(`${input.channel} to ${mask(to)} FAILED: ${err instanceof Error ? err.message : String(err)}`);
            return 'failed';
        }
    }
    async optedOut(phone) {
        const row = await this.prisma.smsOptOut.findUnique({
            where: { phoneNumber: phone },
            select: { id: true },
        });
        return !!row;
    }
    async defaultSmsNumber() {
        const n = await this.prisma.intakeNumber.findFirst({
            where: { releasedAt: null },
            orderBy: { createdAt: 'asc' },
            select: { phoneNumber: true },
        });
        return n?.phoneNumber ?? null;
    }
    async whatsappIdFor(e164) {
        const number = (0, messaging_util_1.asE164)(e164);
        const n = await this.prisma.intakeNumber.findFirst({
            where: {
                releasedAt: null,
                whatsappStatus: 'CONNECTED',
                whatsappPhoneNumberId: { not: null },
                ...(number ? { phoneNumber: number } : {}),
            },
            orderBy: { createdAt: 'asc' },
            select: { whatsappPhoneNumberId: true },
        });
        return n?.whatsappPhoneNumberId ?? null;
    }
    async sendSms(from, to, body) {
        const space = this.env('SIGNALWIRE_SPACE_URL')
            .replace(/^https?:\/\//, '')
            .replace(/\/+$/, '');
        const project = this.env('SIGNALWIRE_PROJECT_ID');
        const auth = Buffer.from(`${project}:${this.env('SIGNALWIRE_API_TOKEN')}`).toString('base64');
        const res = await fetch(`https://${space}/api/laml/2010-04-01/Accounts/${project}/Messages`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: new URLSearchParams((0, messaging_util_1.smsForm)(from, to, body)).toString(),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
            throw new Error(`SignalWire ${res.status}: ${(await res.text()).slice(0, 300)}`);
        }
    }
    async sendWhatsApp(phoneNumberId, to, body) {
        const version = this.env('WHATSAPP_GRAPH_VERSION') ?? 'v23.0';
        const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.env('WHATSAPP_TOKEN')}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify((0, messaging_util_1.whatsappTextPayload)(to, body)),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
            throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 300)}`);
        }
    }
};
exports.CustomerMessenger = CustomerMessenger;
exports.CustomerMessenger = CustomerMessenger = CustomerMessenger_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], CustomerMessenger);
function mask(phone) {
    return phone.length > 8 ? `${phone.slice(0, 5)}***${phone.slice(-4)}` : '***';
}
//# sourceMappingURL=customer-messenger.service.js.map