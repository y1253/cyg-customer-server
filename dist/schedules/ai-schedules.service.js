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
var AiSchedulesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiSchedulesService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const assistant_service_1 = require("../assistant/assistant.service");
const scope_1 = require("../bookkeeping/scope");
const customer_messenger_service_1 = require("../messaging/customer-messenger.service");
const answer_html_1 = require("../mail/answer-html");
const prisma_service_1 = require("../prisma/prisma.service");
const voice_calls_service_1 = require("../voice/voice-calls.service");
const voice_util_1 = require("../voice/voice.util");
const ai_schedules_store_1 = require("./ai-schedules.store");
const next_run_util_1 = require("./next-run.util");
const schedules_service_1 = require("./schedules.service");
const BATCH = 10;
let AiSchedulesService = AiSchedulesService_1 = class AiSchedulesService {
    prisma;
    store;
    schedules;
    assistant;
    messenger;
    voice;
    logger = new common_1.Logger(AiSchedulesService_1.name);
    ticking = false;
    constructor(prisma, store, schedules, assistant, messenger, voice) {
        this.prisma = prisma;
        this.store = store;
        this.schedules = schedules;
        this.assistant = assistant;
        this.messenger = messenger;
        this.voice = voice;
    }
    onModuleInit() {
        this.voice.outboundMissed$.subscribe(({ aiRunId, status }) => {
            if (!aiRunId)
                return;
            void this.callMissed(aiRunId, status).catch((err) => this.logger.error(`ai schedule run #${aiRunId} fallback FAILED: ${err instanceof Error ? err.message : String(err)}`));
        });
    }
    async callMissed(runId, status) {
        const run = await this.prisma.aiScheduleRun.findUnique({
            where: { id: runId },
            include: { schedule: true },
        });
        if (!run || run.channel !== 'CALL')
            return;
        await this.prisma.aiScheduleRun.update({
            where: { id: run.id },
            data: {
                ok: false,
                error: `The call was not answered (${status}), so it was sent again another way.`,
            },
        });
        await this.run(run.schedule, run.manual, 'NO_CALL');
    }
    async list(scope) {
        const rows = await this.store.list(scope);
        return Promise.all(rows.map((r) => this.view(r)));
    }
    async update(scope, id, input) {
        return this.view(await this.store.update(scope, id, input));
    }
    async remove(scope, id) {
        await this.store.remove(scope, id);
    }
    async sendNow(scope, id) {
        const row = await this.store.get(scope, id);
        await this.run(row, true);
        return this.view(await this.store.get(scope, id));
    }
    async tick() {
        if (this.ticking)
            return;
        this.ticking = true;
        try {
            const now = new Date();
            const due = await this.prisma.aiSchedule.findMany({
                where: { active: true, deletedAt: null, nextRunAt: { lte: now } },
                orderBy: { nextRunAt: 'asc' },
                take: BATCH,
            });
            for (const s of due) {
                const claimed = await this.prisma.aiSchedule.updateMany({
                    where: { id: s.id, active: true, nextRunAt: s.nextRunAt },
                    data: {
                        nextRunAt: (0, next_run_util_1.nextRun)((0, ai_schedules_store_1.aiRuleOf)(s), now),
                        lastRunAt: now,
                        ...(s.frequency === 'ONCE' ? { active: false } : {}),
                    },
                });
                if (!claimed.count)
                    continue;
                await this.run(s, false).catch((err) => this.logger.error(`ai schedule #${s.id} FAILED: ${err instanceof Error ? err.message : String(err)}`));
            }
        }
        catch (err) {
            this.logger.error(`ai schedule tick failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            this.ticking = false;
        }
    }
    async run(s, manual, mode = 'NORMAL') {
        const scope = (0, scope_1.scopeOf)(s);
        const record = (data) => this.prisma.aiScheduleRun.create({
            data: {
                scheduleId: s.id,
                manual,
                channel: data.channel,
                ok: data.ok,
                text: data.text?.slice(0, 20_000) ?? null,
                error: data.error?.slice(0, 512) ?? null,
            },
        });
        if (manual && mode === 'NORMAL') {
            await this.prisma.aiSchedule.update({
                where: { id: s.id },
                data: { lastRunAt: new Date() },
            });
        }
        const live = await this.schedules.liveBook(scope);
        if (!live) {
            await this.prisma.aiSchedule.update({
                where: { id: s.id },
                data: { active: false, nextRunAt: null },
            });
            return record({
                channel: 'NONE',
                ok: false,
                error: 'This book no longer exists.',
            });
        }
        const delivery = await this.delivery(s, mode === 'NO_CALL');
        if (!delivery.channel || !delivery.to) {
            return record({
                channel: 'NONE',
                ok: false,
                error: 'No email address or phone number to send to.',
            });
        }
        if (delivery.channel === 'CALL') {
            if (await this.voice.overCallLimit(s.customerId)) {
                return this.run(s, manual, 'NO_CALL');
            }
            const said = await this.assistant.runTask(scope, s.task, 'VOICE');
            if (!said) {
                return record({
                    channel: 'CALL',
                    ok: false,
                    error: 'The AI could not prepare the message this time.',
                });
            }
            const script = (0, voice_util_1.spokenScript)(said);
            const row = await record({ channel: 'CALL', ok: true, text: script });
            const placed = await this.voice.callCustomer({
                scope,
                peer: delivery.to,
                purpose: 'AI_SCHEDULE',
                aiScheduleRunId: row.id,
                script,
            });
            if ('error' in placed) {
                await this.prisma.aiScheduleRun.update({
                    where: { id: row.id },
                    data: {
                        ok: false,
                        error: `The call could not be placed: ${placed.error}`.slice(0, 512),
                    },
                });
                return this.run(s, manual, 'NO_CALL');
            }
            return row;
        }
        const text = await this.assistant.runTask(scope, s.task, delivery.channel);
        if (!text) {
            return record({
                channel: delivery.channel,
                ok: false,
                error: 'The AI could not prepare the message this time.',
            });
        }
        if (delivery.channel === 'SMS') {
            const outcome = await this.messenger.send({
                channel: 'SMS',
                to: delivery.to,
                body: text,
                meta: { ...scope, purpose: 'AI_SCHEDULE' },
            });
            if (outcome === 'sent') {
                await this.schedules.logText(scope, delivery.to, text);
                return record({ channel: 'SMS', ok: true, text });
            }
            if (!live.email) {
                return record({
                    channel: 'SMS',
                    ok: false,
                    text,
                    error: `The text was not sent (${outcome}).`,
                });
            }
            const failed = await this.email(live.email, s.title, text);
            return record({
                channel: 'EMAIL',
                ok: failed === null,
                text,
                error: `The text was not sent (${outcome}), so it was emailed${failed ? ` — and the email failed: ${failed}` : ''}.`,
            });
        }
        const failed = await this.email(delivery.to, s.title, text);
        return record({
            channel: 'EMAIL',
            ok: failed === null,
            text,
            error: failed,
        });
    }
    email(to, title, text) {
        return this.schedules.email(to, {
            subject: title,
            text,
            html: (0, answer_html_1.answerHtml)(text),
            attachments: [],
        });
    }
    async delivery(s, noCall = false) {
        const c = await this.prisma.customer.findUnique({
            where: { id: s.customerId },
            select: { email: true, phoneE164: true },
        });
        if (!c)
            return { channel: null, to: null };
        const canText = Boolean(c.phoneE164) && this.messenger.smsConfigured;
        if (s.channel === 'CALL' &&
            !noCall &&
            c.phoneE164 &&
            (await this.voice.canCall())) {
            return { channel: 'CALL', to: c.phoneE164 };
        }
        if ((s.channel === 'SMS' || s.channel === 'CALL') && canText) {
            return { channel: 'SMS', to: c.phoneE164 };
        }
        if (s.channel === 'EMAIL' || s.channel === 'SMS' || s.channel === 'CALL') {
            return c.email
                ? { channel: 'EMAIL', to: c.email }
                : canText
                    ? { channel: 'SMS', to: c.phoneE164 }
                    : { channel: null, to: null };
        }
        const preferred = await this.schedules.delivery(s.customerId, noCall);
        return preferred.channel === 'SMS' ||
            preferred.channel === 'EMAIL' ||
            preferred.channel === 'CALL'
            ? { channel: preferred.channel, to: preferred.to }
            : { channel: null, to: null };
    }
    async view(s) {
        const runs = await this.prisma.aiScheduleRun.findMany({
            where: { scheduleId: s.id },
            orderBy: { id: 'desc' },
            take: 5,
        });
        const rule = (0, ai_schedules_store_1.aiRuleOf)(s);
        return {
            id: s.id,
            title: s.title,
            task: s.task,
            frequency: rule.frequency,
            weekday: s.weekday,
            monthDay: s.monthDay,
            time: s.time,
            timezone: s.timezone,
            runDate: s.runDate,
            description: this.store.describe(s),
            channel: s.channel === 'EMAIL' || s.channel === 'SMS' || s.channel === 'CALL'
                ? s.channel
                : null,
            active: s.active,
            createdBy: s.createdBy === 'CUSTOMER' ? 'CUSTOMER' : 'AI',
            nextRunAt: s.nextRunAt?.toISOString() ?? null,
            lastRunAt: s.lastRunAt?.toISOString() ?? null,
            createdAt: s.createdAt.toISOString(),
            delivery: await this.delivery(s),
            runs: runs.map((r) => ({
                at: r.createdAt.toISOString(),
                channel: r.channel,
                ok: r.ok,
                error: r.error,
                manual: r.manual,
                text: r.text,
            })),
        };
    }
};
exports.AiSchedulesService = AiSchedulesService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_MINUTE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AiSchedulesService.prototype, "tick", null);
exports.AiSchedulesService = AiSchedulesService = AiSchedulesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        ai_schedules_store_1.AiSchedulesStore,
        schedules_service_1.SchedulesService,
        assistant_service_1.AssistantService,
        customer_messenger_service_1.CustomerMessenger,
        voice_calls_service_1.VoiceCallsService])
], AiSchedulesService);
//# sourceMappingURL=ai-schedules.service.js.map