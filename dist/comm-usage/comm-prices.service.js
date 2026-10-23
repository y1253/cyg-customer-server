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
var CommPricesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommPricesService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const ai_usage_context_1 = require("../ai/ai-usage.context");
const openai_client_1 = require("../ai/openai.client");
const signalwire_client_1 = require("../messaging/signalwire.client");
const prisma_service_1 = require("../prisma/prisma.service");
const comm_usage_service_1 = require("./comm-usage.service");
const comm_usage_util_1 = require("./comm-usage.util");
const BACKFILL_BATCH = 200;
const BACKFILL_WINDOW_MS = 48 * 60 * 60 * 1000;
const BACKFILL_MIN_AGE_MS = 5 * 60 * 1000;
const PRICE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: [...comm_usage_util_1.PRICE_FIELDS],
    properties: Object.fromEntries(comm_usage_util_1.PRICE_FIELDS.map((k) => [k, { type: ['number', 'null'] }])),
};
const PRICE_PROMPT = `You read a phone / messaging provider's public pricing page and give its \
pay-as-you-go list prices in US dollars for US and Canadian (+1) LOCAL numbers:
- smsOutPerSegment / smsInPerSegment: one SMS segment sent / received
- mmsOut / mmsIn: one MMS sent / received
- voiceOutPerMin / voiceInPerMin: one minute of an outbound / inbound call to or from a regular phone (PSTN), local number
- recordingPerMin: one minute of call recording
- whatsappOut / whatsappIn: one WhatsApp message sent / received
Give a price only when the page states it; null otherwise. Never guess, never convert from \
another currency, ignore carrier pass-through fees, volume discounts and toll-free numbers. \
Prices are plain numbers in dollars (e.g. 0.00415).`;
let CommPricesService = CommPricesService_1 = class CommPricesService {
    prisma;
    config;
    signalwire;
    openai;
    usage;
    logger = new common_1.Logger(CommPricesService_1.name);
    backfilling = false;
    refreshing = false;
    constructor(prisma, config, signalwire, openai, usage) {
        this.prisma = prisma;
        this.config = config;
        this.signalwire = signalwire;
        this.openai = openai;
        this.usage = usage;
    }
    onApplicationBootstrap() {
        setTimeout(() => {
            void this.prisma.commProvider
                .count({
                where: { priceSource: { not: 'MANUAL' }, priceCheckedAt: null },
            })
                .then((n) => (n ? this.refreshPrices() : undefined))
                .catch(() => undefined);
        }, 60_000).unref();
    }
    async backfillBilled() {
        if (this.backfilling || !this.signalwire.configured)
            return 0;
        this.backfilling = true;
        let updated = 0;
        try {
            const provider = await this.prisma.commProvider.findUnique({
                where: { name: 'SIGNALWIRE' },
            });
            if (!provider)
                return 0;
            const now = Date.now();
            const window = {
                gte: new Date(now - BACKFILL_WINDOW_MS),
                lte: new Date(now - BACKFILL_MIN_AGE_MS),
            };
            const messages = await this.prisma.commMessage.findMany({
                where: {
                    providerId: provider.id,
                    priceSource: 'LIST',
                    providerSid: { not: null },
                    createdAt: window,
                },
                orderBy: { id: 'asc' },
                take: BACKFILL_BATCH,
            });
            for (const m of messages) {
                const b = await this.signalwire.billed('Messages', m.providerSid);
                const price = (0, comm_usage_util_1.billedPrice)(b?.price);
                if (price === null)
                    continue;
                await this.prisma.commMessage.update({
                    where: { id: m.id },
                    data: {
                        costUsd: price,
                        priceSource: 'BILLED',
                        ...(b?.segments ? { segments: b.segments } : {}),
                        ...(b?.status ? { status: b.status.slice(0, 16) } : {}),
                    },
                });
                updated++;
            }
            const calls = await this.prisma.commCall.findMany({
                where: {
                    providerId: provider.id,
                    priceSource: 'LIST',
                    endedAt: { not: null },
                    createdAt: window,
                },
                orderBy: { id: 'asc' },
                take: BACKFILL_BATCH,
            });
            for (const c of calls) {
                const b = await this.signalwire.billed('Calls', c.callSid);
                const price = (0, comm_usage_util_1.billedPrice)(b?.price);
                if (price === null)
                    continue;
                const recording = Math.ceil(c.recordingSec / 60) *
                    Number(provider.recordingPerMin ?? 0);
                await this.prisma.commCall.update({
                    where: { id: c.id },
                    data: {
                        costUsd: Math.round((price + recording) * 1e6) / 1e6,
                        priceSource: 'BILLED',
                    },
                });
                updated++;
            }
            if (updated)
                this.logger.log(`${updated} text(s)/call(s) given their billed price`);
        }
        catch (err) {
            this.logger.warn(`billed-price backfill failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            this.backfilling = false;
        }
        return updated;
    }
    async refreshPrices() {
        const out = { checked: 0, changed: 0, priced: 0 };
        if (this.refreshing)
            return out;
        this.refreshing = true;
        try {
            const providers = await this.prisma.commProvider.findMany();
            for (const p of providers) {
                if (p.priceSource === 'MANUAL')
                    continue;
                out.checked++;
                if (await this.refreshOne(p))
                    out.changed++;
            }
            this.usage.clearCache();
            out.priced = await this.priceMissing();
            this.logger.log(`phone/text prices checked: ${out.checked} provider(s), ${out.changed} changed, ${out.priced} row(s) priced`);
        }
        catch (err) {
            this.logger.error(`phone/text price refresh failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            this.refreshing = false;
        }
        return out;
    }
    async refreshOne(p) {
        const now = new Date();
        const current = (0, comm_usage_util_1.pricesOf)(p);
        const note = async (priceNote) => {
            this.logger.warn(`${p.name} prices not updated: ${priceNote}`);
            await this.prisma.commProvider.update({
                where: { id: p.id },
                data: { priceCheckedAt: now, priceNote: priceNote.slice(0, 1000) },
            });
            return false;
        };
        const urls = [p.pricingUrl, p.voicePricingUrl].filter((u) => !!u);
        if (!urls.length)
            return note('no pricing page set');
        if (!this.openai.configured)
            return note('the AI is not configured');
        const texts = [];
        for (const url of urls) {
            try {
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (CYG Finance price check)' },
                    signal: AbortSignal.timeout(30_000),
                });
                if (!res.ok)
                    return note(`${url} answered ${res.status}`);
                texts.push(`PAGE ${url}:\n${(0, comm_usage_util_1.pageText)(await res.text(), 40_000)}`);
            }
            catch (err) {
                return note(`${url} could not be read: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        let read;
        try {
            const reply = await (0, ai_usage_context_1.withAiUsage)({ feature: 'OTHER' }, () => this.openai.chat({
                model: this.config.get('OPENAI_BOOKKEEPING_TAX_MODEL')?.trim() ||
                    'gpt-4.1-mini',
                system: PRICE_PROMPT,
                user: `Provider: ${p.label}\n\n${texts.join('\n\n')}`,
                jsonSchema: { name: 'comm_prices', schema: PRICE_SCHEMA },
                maxTokens: 400,
                timeoutMs: 90_000,
            }));
            read = JSON.parse(reply);
        }
        catch (err) {
            return note(`the AI could not read the page: ${err instanceof Error ? err.message : String(err)}`);
        }
        const checked = (0, comm_usage_util_1.checkPagePrices)(read, current);
        if (!checked.ok)
            return note(checked.reason);
        const changed = !(0, comm_usage_util_1.samePrices)(checked.prices, current);
        const found = comm_usage_util_1.PRICE_FIELDS.filter((k) => read[k] != null)
            .map((k) => `${k} ${read[k]}`)
            .join(', ');
        await this.prisma.commProvider.update({
            where: { id: p.id },
            data: {
                ...checked.prices,
                priceSource: 'AUTO',
                priceCheckedAt: now,
                ...(changed && { priceChangedAt: now }),
                priceNote: `Read ${now.toISOString().slice(0, 10)}: ${found}`.slice(0, 1000),
            },
        });
        if (changed)
            this.logger.log(`${p.name} prices changed (or first found)`);
        return changed;
    }
    async priceMissing() {
        let priced = 0;
        const providers = await this.prisma.commProvider.findMany();
        for (const p of providers) {
            const prices = (0, comm_usage_util_1.pricesOf)(p);
            const messages = await this.prisma.commMessage.findMany({
                where: { providerId: p.id, costUsd: null },
                take: 5000,
            });
            for (const m of messages) {
                const cost = (0, comm_usage_util_1.messageCost)(prices, {
                    channel: m.channel,
                    direction: m.direction,
                    segments: m.segments,
                    media: m.media,
                });
                if (cost === null)
                    continue;
                await this.prisma.commMessage.update({
                    where: { id: m.id },
                    data: { costUsd: cost },
                });
                priced++;
            }
            const calls = await this.prisma.commCall.findMany({
                where: { providerId: p.id, costUsd: null, endedAt: { not: null } },
                take: 5000,
            });
            for (const c of calls) {
                const cost = (0, comm_usage_util_1.callCost)(prices, {
                    direction: c.direction,
                    durationSec: c.durationSec,
                    recordingSec: c.recordingSec,
                });
                if (cost === null)
                    continue;
                await this.prisma.commCall.update({
                    where: { id: c.id },
                    data: { costUsd: cost },
                });
                priced++;
            }
        }
        return priced;
    }
};
exports.CommPricesService = CommPricesService;
__decorate([
    (0, schedule_1.Cron)('*/10 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CommPricesService.prototype, "backfillBilled", null);
__decorate([
    (0, schedule_1.Cron)('0 4 * * 1'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CommPricesService.prototype, "refreshPrices", null);
exports.CommPricesService = CommPricesService = CommPricesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        signalwire_client_1.SignalWireClient,
        openai_client_1.OpenAiClient,
        comm_usage_service_1.CommUsageService])
], CommPricesService);
//# sourceMappingURL=comm-prices.service.js.map