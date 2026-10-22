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
var AiUsageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiUsageService = exports.pricesOf = exports.LITELLM_PRICES_URL = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const ai_usage_context_1 = require("../ai/ai-usage.context");
const usage_util_1 = require("../ai/usage.util");
const prisma_service_1 = require("../prisma/prisma.service");
exports.LITELLM_PRICES_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const MODEL_CACHE_MS = 10 * 60_000;
const LIST_CACHE_MS = 24 * 60 * 60_000;
const num = (v) => v === null ? null : Number(v.toString());
const pricesOf = (m) => ({
    inputPerMTok: num(m.inputPerMTok),
    cachedInputPerMTok: num(m.cachedInputPerMTok),
    outputPerMTok: num(m.outputPerMTok),
    audioInputPerMTok: num(m.audioInputPerMTok),
    audioOutputPerMTok: num(m.audioOutputPerMTok),
    perMinute: num(m.perMinute),
});
exports.pricesOf = pricesOf;
let AiUsageService = AiUsageService_1 = class AiUsageService {
    prisma;
    logger = new common_1.Logger(AiUsageService_1.name);
    models = new Map();
    list = null;
    refreshing = false;
    constructor(prisma) {
        this.prisma = prisma;
    }
    record(model, kind, usage, durationMs, feature) {
        const outer = (0, ai_usage_context_1.currentAiUsage)();
        this.recordFor(feature ? { ...outer, feature } : outer, model, kind, usage, durationMs);
    }
    recordFor(ctx, model, kind, usage, durationMs) {
        const tokens = (0, usage_util_1.parseUsage)(kind, usage);
        if (!tokens || (0, usage_util_1.isEmptyUsage)(tokens) || !model.trim())
            return;
        void this.save(model.trim(), tokens, durationMs, ctx).catch((err) => this.logger.warn(`usage not recorded (${model}): ${err instanceof Error ? err.message : String(err)}`));
    }
    async save(model, t, durationMs, ctx) {
        const row = await this.model(model);
        await this.prisma.aiUsage.create({
            data: {
                customerId: ctx.customerId,
                companyId: ctx.companyId,
                feature: ctx.feature,
                modelId: row.id,
                inputTokens: t.input,
                cachedInputTokens: t.cached,
                outputTokens: t.output,
                audioInputTokens: t.audioIn,
                audioOutputTokens: t.audioOut,
                audioSeconds: t.audioSeconds,
                durationMs: Math.max(0, Math.round(durationMs)),
                costUsd: (0, usage_util_1.costOf)((0, exports.pricesOf)(row), t),
            },
        });
    }
    async model(name) {
        const hit = this.models.get(name);
        if (hit instanceof Promise)
            return hit;
        if (hit && Date.now() - hit.at < MODEL_CACHE_MS)
            return hit.row;
        const pending = this.loadModel(name);
        this.models.set(name, pending);
        try {
            const row = await pending;
            this.models.set(name, { row, at: Date.now() });
            return row;
        }
        catch (err) {
            this.models.delete(name);
            throw err;
        }
    }
    async loadModel(name) {
        const found = await this.prisma.aiModel.findUnique({ where: { name } });
        if (found)
            return found;
        const prices = await this.lookup(name);
        try {
            return await this.prisma.aiModel.create({
                data: {
                    name,
                    ...(prices ?? {}),
                    priceSource: prices ? 'LITELLM' : 'NONE',
                    priceCheckedAt: new Date(),
                },
            });
        }
        catch {
            return this.prisma.aiModel.findUniqueOrThrow({ where: { name } });
        }
    }
    async lookup(name, fresh = false) {
        const list = await this.priceList(fresh);
        return list ? (0, usage_util_1.pricesFromLiteLlm)(list, name) : null;
    }
    async priceList(fresh) {
        if (!fresh && this.list && Date.now() - this.list.at < LIST_CACHE_MS) {
            return this.list.data;
        }
        try {
            const res = await fetch(exports.LITELLM_PRICES_URL, {
                signal: AbortSignal.timeout(30_000),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const data = (await res.json());
            this.list = { data, at: Date.now() };
            return data;
        }
        catch (err) {
            this.logger.warn(`price list not fetched: ${err instanceof Error ? err.message : String(err)}`);
            return this.list?.data ?? null;
        }
    }
    async refreshPrices() {
        const out = { checked: 0, changed: 0, filled: 0 };
        if (this.refreshing)
            return out;
        this.refreshing = true;
        try {
            const list = await this.priceList(true);
            const models = await this.prisma.aiModel.findMany();
            const now = new Date();
            for (const m of models) {
                if (m.priceSource !== 'MANUAL' && list) {
                    out.checked++;
                    const prices = (0, usage_util_1.pricesFromLiteLlm)(list, m.name);
                    if (prices) {
                        const changed = !(0, usage_util_1.samePrices)(prices, (0, exports.pricesOf)(m));
                        if (changed) {
                            out.changed++;
                            this.logger.log(`price of ${m.name} changed (or first found)`);
                        }
                        await this.prisma.aiModel.update({
                            where: { id: m.id },
                            data: {
                                ...prices,
                                priceSource: 'LITELLM',
                                priceCheckedAt: now,
                                ...(changed && { priceChangedAt: now }),
                            },
                        });
                    }
                    else {
                        await this.prisma.aiModel.update({
                            where: { id: m.id },
                            data: { priceCheckedAt: now },
                        });
                    }
                }
                this.models.delete(m.name);
            }
            out.filled = await this.fillMissingCosts();
            this.logger.log(`prices checked: ${out.checked} model(s), ${out.changed} changed, ${out.filled} call(s) priced`);
        }
        catch (err) {
            this.logger.error(`price refresh failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            this.refreshing = false;
        }
        return out;
    }
    async fillMissingCosts() {
        let filled = 0;
        const models = await this.prisma.aiModel.findMany({
            where: { priceSource: { not: 'NONE' } },
        });
        for (const m of models) {
            const prices = (0, exports.pricesOf)(m);
            for (;;) {
                const rows = await this.prisma.aiUsage.findMany({
                    where: { modelId: m.id, costUsd: null },
                    take: 500,
                });
                if (!rows.length)
                    break;
                let priced = 0;
                for (const r of rows) {
                    const cost = (0, usage_util_1.costOf)(prices, {
                        input: r.inputTokens,
                        cached: r.cachedInputTokens,
                        output: r.outputTokens,
                        audioIn: r.audioInputTokens,
                        audioOut: r.audioOutputTokens,
                        audioSeconds: r.audioSeconds,
                    });
                    if (cost === null)
                        continue;
                    await this.prisma.aiUsage.update({
                        where: { id: r.id },
                        data: { costUsd: cost },
                    });
                    priced++;
                }
                filled += priced;
                if (!priced || rows.length < 500)
                    break;
            }
        }
        return filled;
    }
};
exports.AiUsageService = AiUsageService;
__decorate([
    (0, schedule_1.Cron)('0 4 * * 1'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AiUsageService.prototype, "refreshPrices", null);
exports.AiUsageService = AiUsageService = AiUsageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AiUsageService);
//# sourceMappingURL=ai-usage.service.js.map