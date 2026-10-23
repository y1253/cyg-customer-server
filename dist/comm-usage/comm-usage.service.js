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
var CommUsageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommUsageService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const comm_usage_util_1 = require("./comm-usage.util");
const PROVIDER_CACHE_MS = 10 * 60 * 1000;
let CommUsageService = CommUsageService_1 = class CommUsageService {
    prisma;
    logger = new common_1.Logger(CommUsageService_1.name);
    providers = new Map();
    constructor(prisma) {
        this.prisma = prisma;
    }
    clearCache() {
        this.providers.clear();
    }
    async provider(name) {
        const hit = this.providers.get(name);
        if (hit && Date.now() - hit.at < PROVIDER_CACHE_MS)
            return hit.row;
        const row = await this.prisma.commProvider.findUnique({ where: { name } });
        this.providers.set(name, { row, at: Date.now() });
        return row;
    }
    recordMessage(m) {
        void this.saveMessage(m).catch((err) => this.logger.warn(`${m.channel} ${m.direction} not recorded: ${err instanceof Error ? err.message : String(err)}`));
    }
    async saveMessage(m) {
        const provider = await this.provider(m.channel === 'WHATSAPP' ? 'WHATSAPP' : 'SIGNALWIRE');
        if (!provider)
            return;
        const media = m.media ?? 0;
        const segments = m.channel === 'SMS' && !media
            ? Math.max(1, m.segments ?? (0, comm_usage_util_1.segmentsOf)(m.body ?? ''))
            : 1;
        const cost = (0, comm_usage_util_1.messageCost)((0, comm_usage_util_1.pricesOf)(provider), {
            channel: m.channel,
            direction: m.direction,
            segments,
            media,
        });
        await this.prisma.commMessage.create({
            data: {
                customerId: m.customerId ?? null,
                bookId: m.bookId ?? null,
                companyId: m.companyId ?? null,
                providerId: provider.id,
                channel: m.channel,
                direction: m.direction,
                purpose: m.purpose,
                providerSid: m.providerSid?.slice(0, 128) || null,
                fromNumber: m.from?.slice(0, 32) ?? null,
                toNumber: m.to?.slice(0, 32) ?? null,
                segments,
                media,
                status: m.status?.slice(0, 16) ?? null,
                costUsd: cost,
            },
        });
    }
    callStarted(c) {
        void (async () => {
            const provider = await this.provider('SIGNALWIRE');
            if (!provider)
                return;
            const data = {
                customerId: c.customerId ?? null,
                bookId: c.bookId ?? null,
                companyId: c.companyId ?? null,
                aiCallId: c.aiCallId ?? null,
                direction: c.direction,
                purpose: c.purpose.slice(0, 24),
                fromNumber: c.from?.slice(0, 32) ?? null,
                toNumber: c.to?.slice(0, 32) ?? null,
            };
            await this.prisma.commCall.upsert({
                where: { callSid: c.callSid },
                create: { ...data, callSid: c.callSid, providerId: provider.id },
                update: data,
            });
        })().catch((err) => this.logger.warn(`call ${c.callSid} not recorded: ${err instanceof Error ? err.message : String(err)}`));
    }
    callEnded(callSid, e) {
        void (async () => {
            const row = await this.prisma.commCall.findUnique({
                where: { callSid },
                include: { provider: true },
            });
            if (!row)
                return;
            const durationSec = Math.max(row.durationSec, Math.round(e.durationSec));
            const recordingSec = e.recorded ? durationSec : row.recordingSec;
            const keepBilled = row.priceSource === 'BILLED';
            await this.prisma.commCall.update({
                where: { id: row.id },
                data: {
                    durationSec,
                    billedMinutes: (0, comm_usage_util_1.billedMinutes)(durationSec),
                    recordingSec,
                    endedAt: row.endedAt ?? new Date(),
                    ...(!keepBilled && {
                        costUsd: (0, comm_usage_util_1.callCost)((0, comm_usage_util_1.pricesOf)(row.provider), {
                            direction: row.direction,
                            durationSec,
                            recordingSec,
                        }),
                    }),
                },
            });
        })().catch((err) => this.logger.warn(`call ${callSid} end not recorded: ${err instanceof Error ? err.message : String(err)}`));
    }
};
exports.CommUsageService = CommUsageService;
exports.CommUsageService = CommUsageService = CommUsageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CommUsageService);
//# sourceMappingURL=comm-usage.service.js.map