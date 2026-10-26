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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var SalesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SalesService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
const ai_usage_context_1 = require("../ai/ai-usage.context");
const openai_client_1 = require("../ai/openai.client");
const instructions_service_1 = require("../assistant/instructions.service");
const pricing_1 = require("../billing/pricing");
const customer_messenger_service_1 = require("../messaging/customer-messenger.service");
const messaging_util_1 = require("../messaging/messaging.util");
const reach_1 = require("../messaging/reach");
const prisma_service_1 = require("../prisma/prisma.service");
const sales_prompt_1 = require("./sales-prompt");
const OFFER_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY = 20;
const MAX_TOOL_ROUNDS = 2;
let SalesService = SalesService_1 = class SalesService {
    prisma;
    config;
    openai;
    messenger;
    instructions;
    logger = new common_1.Logger(SalesService_1.name);
    perPhone = new sales_prompt_1.DailyCounter();
    total = new sales_prompt_1.DailyCounter();
    callsPerPhone = new sales_prompt_1.DailyCounter();
    constructor(prisma, config, openai, messenger, instructions) {
        this.prisma = prisma;
        this.config = config;
        this.openai = openai;
        this.messenger = messenger;
        this.instructions = instructions;
    }
    num(key, fallback) {
        const n = Number(this.config.get(key));
        return Number.isFinite(n) && n > 0 ? n : fallback;
    }
    model() {
        return (this.config.get('OPENAI_ASSISTANT_MODEL')?.trim() || 'gpt-4.1');
    }
    async enabled() {
        if (!this.openai.configured)
            return false;
        const row = await this.prisma.customerVoiceSettings
            .findUnique({
            where: { singleton: 'GLOBAL' },
            select: { salesEnabled: true },
        })
            .catch(() => null);
        return !!row?.salesEnabled;
    }
    takeCall(phone) {
        return this.callsPerPhone.take(phone, this.num('SALES_CALLS_PER_PHONE_PER_DAY', 3));
    }
    async touch(rawPhone, channel) {
        const phoneE164 = (0, messaging_util_1.asE164)(rawPhone);
        if (!phoneE164)
            throw new Error('not a phone number');
        const upsert = () => this.prisma.prospect.upsert({
            where: { phoneE164 },
            create: { phoneE164, firstChannel: channel },
            update: { lastContactAt: new Date() },
        });
        try {
            return await upsert();
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002') {
                return upsert();
            }
            throw err;
        }
    }
    save(prospectId, channel, role, text, callSid) {
        return this.prisma.prospectMessage.create({
            data: {
                prospectId,
                channel,
                role,
                text: text.slice(0, 20_000),
                callSid: callSid ?? null,
            },
        });
    }
    offeredRecently(p) {
        return (!!p.signupOfferedAt &&
            Date.now() - p.signupOfferedAt.getTime() <= OFFER_TTL_MS);
    }
    markOffered(id, channel) {
        return this.prisma.prospect.update({
            where: { id },
            data: { signupOfferedAt: new Date(), signupOfferChannel: channel },
        });
    }
    async prompt(p, channel, call) {
        const [pricing, reach, extras] = await Promise.all([
            (0, pricing_1.readPricing)(this.prisma).catch(() => null),
            (0, reach_1.firmReach)(this.prisma, this.config).catch(() => null),
            this.instructions?.sales().catch(() => undefined),
        ]);
        return (0, sales_prompt_1.salesPrompt)({
            channel,
            today: new Date().toISOString().slice(0, 10),
            pricing,
            reach,
            offered: this.offeredRecently(p),
            language: call?.language,
            maxMinutes: call?.maxMinutes,
        }, extras);
    }
    async history(prospectId) {
        const rows = await this.prisma.prospectMessage.findMany({
            where: { prospectId },
            orderBy: { id: 'desc' },
            take: HISTORY,
        });
        return rows.reverse().map((m) => m.role === 'USER'
            ? {
                role: 'user',
                content: m.channel === 'CALL' ? `(on a call) ${m.text}` : m.text,
            }
            : { role: 'assistant', content: m.text });
    }
    async replyToText(input) {
        const none = { reply: null, offered: false };
        const text = input.text.trim();
        if (!text || !(await this.enabled()))
            return none;
        const phone = (0, messaging_util_1.asE164)(input.phone);
        if (!phone)
            return none;
        if (!this.perPhone.take(phone, this.num('SALES_REPLIES_PER_PHONE_PER_DAY', 30))) {
            return none;
        }
        if (!this.total.take('all', this.num('SALES_REPLIES_PER_DAY', 500))) {
            this.logger.warn('daily salesperson limit reached');
            return none;
        }
        let prospect = await this.touch(phone, input.channel);
        const history = await this.history(prospect.id);
        await this.save(prospect.id, input.channel, 'USER', text);
        const system = await this.prompt(prospect, input.channel);
        let offered = false;
        const answer = await (0, ai_usage_context_1.withAiUsage)({ customerId: null, bookId: null, companyId: null, feature: 'SALES' }, async () => {
            const messages = [
                { role: 'system', content: system },
                ...history,
                { role: 'user', content: text },
            ];
            for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
                const last = round === MAX_TOOL_ROUNDS;
                const r = await this.openai.chatMessages({
                    model: this.model(),
                    messages,
                    tools: last ? undefined : [sales_prompt_1.OFFER_SIGNUP_TOOL],
                    maxTokens: 500,
                    timeoutMs: 60_000,
                });
                if (!r.toolCalls.length || last)
                    return r.content?.trim() || null;
                messages.push({
                    role: 'assistant',
                    content: r.content,
                    toolCalls: r.toolCalls,
                });
                for (const call of r.toolCalls) {
                    let content = `Unknown tool ${call.name}.`;
                    if (call.name === sales_prompt_1.OFFER_SIGNUP_TOOL.name) {
                        offered = true;
                        content =
                            'Done: the "Reply YES" line is added under your answer. Write only a short, warm answer.';
                    }
                    messages.push({ role: 'tool', toolCallId: call.id, content });
                }
            }
            return null;
        }).catch((err) => {
            this.logger.warn(`salesperson ${input.channel} failed: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        });
        if (!answer)
            return none;
        if (offered)
            prospect = await this.markOffered(prospect.id, input.channel);
        const reply = (0, sales_prompt_1.withSignupLine)(answer, offered);
        await this.save(prospect.id, input.channel, 'ASSISTANT', reply);
        return { reply, offered };
    }
    async offerOnCall(prospectId, from) {
        const p = await this.prisma.prospect.findUnique({
            where: { id: prospectId },
        });
        if (!p)
            return 'Could not send the text.';
        if (p.customerId) {
            return 'They already have an account now: tell them to text or call this number anytime.';
        }
        if (p.signupOfferChannel === 'CALL' &&
            p.signupOfferedAt &&
            Date.now() - p.signupOfferedAt.getTime() < 10 * 60_000) {
            return 'The sign-up text was already sent a moment ago: tell them to reply YES to it.';
        }
        const sent = await this.messenger.send({
            channel: 'SMS',
            to: p.phoneE164,
            from: from ?? null,
            body: sales_prompt_1.CALL_SIGNUP_TEXT,
            meta: { customerId: null, purpose: 'SIGNUP_OFFER' },
        });
        if (sent !== 'sent') {
            this.logger.warn(`call sign-up text for prospect ${p.id}: ${sent}`);
            return sent === 'opted-out'
                ? 'They opted out of our texts, so no text can be sent. Tell them they can sign up at cygfinance.com instead.'
                : 'The text could not be sent. Tell them they can sign up at cygfinance.com instead.';
        }
        await this.markOffered(p.id, 'CALL');
        await this.save(p.id, 'CALL', 'ASSISTANT', `[texted] ${sales_prompt_1.CALL_SIGNUP_TEXT}`);
        return 'Texted. Tell them to reply YES to that text and their account opens right away on this number.';
    }
};
exports.SalesService = SalesService;
exports.SalesService = SalesService = SalesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        openai_client_1.OpenAiClient,
        customer_messenger_service_1.CustomerMessenger,
        instructions_service_1.InstructionsService])
], SalesService);
//# sourceMappingURL=sales.service.js.map