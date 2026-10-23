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
var VoiceCallsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceCallsService = void 0;
exports.toCallView = toCallView;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const rxjs_1 = require("rxjs");
const assistant_tools_1 = require("../assistant/assistant-tools");
const customer_outbox_service_1 = require("../assistant/customer-outbox.service");
const books_1 = require("../bookkeeping/books");
const scope_1 = require("../bookkeeping/scope");
const signalwire_client_1 = require("../messaging/signalwire.client");
const messaging_util_1 = require("../messaging/messaging.util");
const prisma_service_1 = require("../prisma/prisma.service");
const object_storage_service_1 = require("../storage/object-storage.service");
const voice_util_1 = require("./voice.util");
const DEFAULT_AI_CALLS_PER_DAY = 5;
const RING_SECONDS = 30;
let VoiceCallsService = VoiceCallsService_1 = class VoiceCallsService {
    prisma;
    config;
    signalwire;
    storage;
    tools;
    outbox;
    logger = new common_1.Logger(VoiceCallsService_1.name);
    jwt;
    outboundMissed$ = new rxjs_1.Subject();
    personCalls = new Map();
    constructor(prisma, config, signalwire, storage, tools, outbox) {
        this.prisma = prisma;
        this.config = config;
        this.signalwire = signalwire;
        this.storage = storage;
        this.tools = tools;
        this.outbox = outbox;
        this.jwt = new jwt_1.JwtService({
            secret: config.getOrThrow('CUSTOMER_JWT_SECRET'),
        });
    }
    onModuleInit() {
        this.tools?.setCallHandler((ctx, about) => this.callMeNow(ctx, about));
        this.tools?.setPersonCallHandler((ctx, person, message) => this.callPersonNow(ctx, person, message));
    }
    async callMeNow(ctx, about) {
        const customer = await this.prisma.customer.findFirst({
            where: { id: ctx.scope.customerId, deletedAt: null },
            select: { phoneE164: true },
        });
        if (!customer?.phoneE164) {
            return {
                ok: false,
                error: 'There is no phone number on the account — they can add one on the Account page.',
            };
        }
        if (!(await this.canCall()))
            return { ok: false, error: 'Phone calls are not set up right now.' };
        if (await this.overCallLimit(ctx.scope.customerId)) {
            return {
                ok: false,
                error: "Today's limit of calls from the assistant is reached — try again tomorrow.",
            };
        }
        const scope = ctx.scope;
        const peer = customer.phoneE164;
        setTimeout(() => {
            void this.callCustomer({
                scope,
                peer,
                purpose: 'REQUESTED',
                script: `They asked you to call them about: ${about}. Start with that.`,
            }).then((r) => {
                if ('error' in r)
                    this.logger.warn(`call_me for customer ${scope.customerId} not placed: ${r.error}`);
            });
        }, 4000);
        return {
            ok: true,
            summary: `Calling the customer at the number ending ${peer.slice(-4)}`,
        };
    }
    async callPersonNow(ctx, person, message) {
        if (!(await this.canCall()))
            return { ok: false, error: 'Phone calls are not set up right now.' };
        if (await this.overCallLimit(ctx.scope.customerId)) {
            return {
                ok: false,
                error: "Today's limit of calls from the assistant is reached — try again tomorrow.",
            };
        }
        const scope = ctx.scope;
        const origin = ctx.conversation?.id ?? null;
        const label = person.name ?? person.phone;
        setTimeout(() => {
            void this.callCustomer({
                scope,
                peer: person.phone,
                purpose: 'THIRD_PARTY',
                script: message,
                contactId: person.contactId,
                contactName: person.name,
            }).then((r) => {
                if ('error' in r) {
                    this.logger.warn(`call_person for customer ${scope.customerId} not placed: ${r.error}`);
                    if (origin)
                        void this.reportToCustomer(origin, `I couldn't call ${label}: ${r.error}`);
                }
                else if (origin) {
                    this.personCalls.set(r.callSid, {
                        originConversationId: origin,
                        name: person.name,
                        phone: person.phone,
                    });
                }
            });
        }, 4000);
        return { ok: true, summary: `Calling ${label} (${person.phone})` };
    }
    async reportPersonCall(call) {
        const pending = this.personCalls.get(call.callSid);
        if (!pending)
            return;
        this.personCalls.delete(call.callSid);
        const label = pending.name
            ? `${pending.name} (${pending.phone})`
            : pending.phone;
        let text;
        if (!call.answeredAt) {
            text = `I called ${label} but nobody answered, so your message was not delivered. Want me to text them instead, or try again later?`;
        }
        else {
            const said = await this.prisma.aiMessage.findMany({
                where: {
                    conversationId: call.conversationId,
                    role: 'USER',
                    createdAt: { gte: call.startedAt },
                },
                orderBy: { id: 'asc' },
                select: { text: true },
            });
            const words = said
                .map((m) => m.text.trim())
                .filter(Boolean)
                .join(' ')
                .slice(0, 600);
            text = `I called ${label} and gave them your message.${words ? ` They said: "${words}"` : ''}`;
        }
        await this.reportToCustomer(pending.originConversationId, text);
    }
    async reportToCustomer(conversationId, text) {
        try {
            const origin = await this.prisma.aiConversation.findUnique({
                where: { id: conversationId },
            });
            if (!origin)
                return;
            const scope = (0, scope_1.scopeOf)(origin);
            const channel = origin.channel === 'SMS' ||
                origin.channel === 'WHATSAPP' ||
                origin.channel === 'EMAIL'
                ? origin.channel
                : origin.channel === 'VOICE'
                    ? 'SMS'
                    : null;
            if (channel && this.outbox) {
                const sent = await this.outbox.send(scope, channel, text);
                if (sent.ok)
                    return;
            }
            await this.prisma.aiMessage.create({
                data: {
                    conversationId: origin.id,
                    customerId: origin.customerId,
                    bookId: origin.bookId,
                    companyId: origin.companyId,
                    channel: origin.channel,
                    role: 'ASSISTANT',
                    text,
                },
            });
            await this.prisma.aiConversation.update({
                where: { id: origin.id },
                data: { lastMessageAt: new Date() },
            });
        }
        catch (err) {
            this.logger.warn(`call_person report not delivered: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async overCallLimit(customerId) {
        const max = Number(this.config.get('AI_CALLS_PER_DAY'));
        const limit = Number.isFinite(max) && max >= 0 ? max : DEFAULT_AI_CALLS_PER_DAY;
        const since = new Date();
        since.setUTCHours(0, 0, 0, 0);
        const count = await this.prisma.aiCall.count({
            where: {
                customerId,
                direction: 'OUTBOUND',
                purpose: { in: ['REQUESTED', 'AI_SCHEDULE', 'THIRD_PARTY'] },
                startedAt: { gte: since },
            },
        });
        return count >= limit;
    }
    async settings() {
        const row = await this.prisma.customerVoiceSettings
            .findUnique({ where: { singleton: 'GLOBAL' } })
            .catch(() => null);
        return {
            enabled: row?.enabled ?? false,
            voice: (0, voice_util_1.isVoice)(row?.voice) ? row.voice : voice_util_1.DEFAULT_VOICE,
            greeting: row?.greeting?.trim() || null,
            maxMinutes: Math.min(Math.max(row?.maxMinutes ?? 15, 1), 60),
            language: (0, voice_util_1.isLanguage)(row?.language) ? row.language : voice_util_1.DEFAULT_LANGUAGE,
        };
    }
    async canCall() {
        return ((await this.settings()).enabled &&
            this.signalwire.configured &&
            !!this.config.get('OPENAI_API_KEY')?.trim());
    }
    base() {
        return (this.config.get('PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '') ||
            'https://cygfinance.com');
    }
    streamUrl() {
        return (this.config.get('VOICE_STREAM_URL')?.trim() ||
            `${this.base().replace(/^http/, 'ws')}/api/voice/stream`);
    }
    statusUrl() {
        return `${this.base()}/api/voice/status`;
    }
    sign(claims, ttlSeconds = 300) {
        return this.jwt.sign({ ...claims, typ: voice_util_1.VOICE_TOKEN_TYPE }, { expiresIn: ttlSeconds });
    }
    verify(token) {
        if (!token)
            return null;
        try {
            const c = this.jwt.verify(token);
            return c.typ === voice_util_1.VOICE_TOKEN_TYPE &&
                typeof c.sub === 'number' &&
                (0, messaging_util_1.asE164)(c.peer)
                ? c
                : null;
        }
        catch {
            return null;
        }
    }
    async conversationFor(claims) {
        const found = await this.prisma.aiConversation.findFirst({
            where: {
                customerId: claims.sub,
                channel: 'VOICE',
                peer: claims.peer,
                attachmentId: null,
            },
            orderBy: { id: 'desc' },
        });
        const pinned = claims.dir === 'OUTBOUND' &&
            (claims.bookId !== undefined || claims.companyId !== undefined)
            ? await (0, books_1.legacyBook)(this.prisma, claims.sub, claims)
            : null;
        const book = pinned
            ? {
                bookId: pinned.bookId,
                companyId: pinned.companyId,
                bookChosen: true,
                awaitingBook: false,
            }
            : null;
        if (found) {
            return book
                ? this.prisma.aiConversation.update({
                    where: { id: found.id },
                    data: book,
                })
                : found;
        }
        const sms = book
            ? null
            : await this.prisma.aiConversation.findFirst({
                where: {
                    customerId: claims.sub,
                    channel: { in: ['SMS', 'WHATSAPP'] },
                    peer: claims.peer,
                    bookChosen: true,
                },
                orderBy: { lastMessageAt: 'desc' },
            });
        const fallback = book || sms ? null : await (0, books_1.ensureDefaultBook)(this.prisma, claims.sub);
        return this.prisma.aiConversation.create({
            data: {
                customerId: claims.sub,
                channel: 'VOICE',
                peer: claims.peer,
                title: claims.purpose === 'THIRD_PARTY'
                    ? `Calls with ${claims.contactName ?? claims.peer}`
                    : 'Phone calls',
                bookId: (book ?? sms ?? fallback).bookId,
                companyId: (book ?? sms ?? fallback).companyId,
                bookChosen: book?.bookChosen ?? !!sms,
            },
        });
    }
    async started(claims, conversation, callSid) {
        const existing = await this.prisma.aiCall.findUnique({
            where: { callSid },
        });
        if (existing) {
            return this.prisma.aiCall.update({
                where: { id: existing.id },
                data: {
                    status: 'IN_PROGRESS',
                    answeredAt: existing.answeredAt ?? new Date(),
                    conversationId: conversation.id,
                },
            });
        }
        return this.prisma.aiCall.create({
            data: {
                customerId: claims.sub,
                bookId: conversation.bookId,
                companyId: conversation.companyId,
                conversationId: conversation.id,
                callSid,
                direction: claims.dir,
                peer: claims.peer,
                fromNumber: claims.to ?? null,
                purpose: claims.purpose ?? 'INBOUND',
                contactId: claims.contactId ?? null,
                scheduleRunId: claims.runId ?? null,
                status: 'IN_PROGRESS',
                answeredAt: new Date(),
            },
        });
    }
    async ended(callSid, extra) {
        const call = await this.prisma.aiCall.findUnique({ where: { callSid } });
        if (!call)
            return;
        let recordingKey = null;
        if (extra.wav && !extra.recordingSid && this.storage.configured) {
            recordingKey = `voice/${call.customerId}/${call.callSid}.wav`;
            await this.storage
                .putBuffer(recordingKey, extra.wav, 'audio/wav')
                .catch((err) => {
                recordingKey = null;
                this.logger.warn(`call ${callSid}: recording not stored: ${err instanceof Error ? err.message : String(err)}`);
            });
        }
        const end = new Date();
        const from = call.answeredAt ?? call.startedAt;
        await this.prisma.aiCall.update({
            where: { id: call.id },
            data: {
                status: call.status === 'IN_PROGRESS' ? 'COMPLETED' : call.status,
                endedAt: end,
                durationSec: Math.max(0, Math.round((end.getTime() - from.getTime()) / 1000)),
                ...(extra.recordingSid ? { recordingSid: extra.recordingSid } : {}),
                ...(recordingKey ? { recordingKey } : {}),
                ...(extra.error ? { error: extra.error.slice(0, 512) } : {}),
            },
        });
        if (call.purpose === 'THIRD_PARTY') {
            const fresh = await this.prisma.aiCall.findUnique({
                where: { id: call.id },
            });
            if (fresh)
                await this.reportPersonCall(fresh);
        }
    }
    async callCustomer(input) {
        const to = (0, messaging_util_1.asE164)(input.peer);
        if (!to)
            return { error: 'No phone number to call.' };
        if (!(await this.canCall()))
            return { error: 'Phone calls are not set up.' };
        const from = await this.prisma.intakeNumber.findFirst({
            where: { releasedAt: null },
            orderBy: { createdAt: 'asc' },
            select: { phoneNumber: true },
        });
        if (!from)
            return { error: 'No receipt number to call from.' };
        const claims = {
            sub: input.scope.customerId,
            peer: to,
            to: from.phoneNumber,
            dir: 'OUTBOUND',
            purpose: input.purpose,
            bookId: input.scope.bookId,
            runId: input.runId ?? null,
            script: input.script.slice(0, 1500),
            ...(input.purpose === 'THIRD_PARTY'
                ? {
                    contactId: input.contactId ?? null,
                    contactName: input.contactName ?? null,
                }
                : {}),
        };
        try {
            const callSid = await this.signalwire.createCall({
                to,
                from: from.phoneNumber,
                laml: (0, voice_util_1.connectStreamLaml)(this.streamUrl(), {
                    token: this.sign(claims, 600),
                }),
                statusCallback: this.statusUrl(),
                record: true,
                timeoutSec: RING_SECONDS,
            });
            const conversation = await this.conversationFor({
                ...claims,
                typ: voice_util_1.VOICE_TOKEN_TYPE,
            });
            await this.prisma.aiCall.create({
                data: {
                    customerId: input.scope.customerId,
                    bookId: input.scope.bookId,
                    companyId: input.scope.companyId,
                    conversationId: conversation.id,
                    callSid,
                    direction: 'OUTBOUND',
                    peer: to,
                    fromNumber: from.phoneNumber,
                    purpose: input.purpose,
                    contactId: input.contactId ?? null,
                    scheduleRunId: input.runId ?? null,
                    aiScheduleRunId: input.aiScheduleRunId ?? null,
                    status: 'RINGING',
                },
            });
            return { callSid };
        }
        catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
        }
    }
    async onStatus(callSid, rawStatus, durationSec) {
        const call = await this.prisma.aiCall.findUnique({ where: { callSid } });
        if (!call)
            return;
        const status = (0, voice_util_1.callStatusOf)(rawStatus);
        const terminal = status === 'COMPLETED' || status === 'NO_ANSWER' || status === 'FAILED';
        const next = call.answeredAt && terminal ? 'COMPLETED' : status;
        await this.prisma.aiCall.update({
            where: { id: call.id },
            data: {
                status: next,
                ...(terminal && !call.endedAt ? { endedAt: new Date() } : {}),
                ...(terminal && durationSec !== null && !call.durationSec
                    ? { durationSec }
                    : {}),
            },
        });
        if (terminal && !call.answeredAt && call.purpose === 'THIRD_PARTY') {
            await this.reportPersonCall(call);
        }
        if (terminal &&
            !call.answeredAt &&
            (status === 'NO_ANSWER' || status === 'FAILED') &&
            (call.scheduleRunId || call.aiScheduleRunId)) {
            this.outboundMissed$.next({
                runId: call.scheduleRunId,
                aiRunId: call.aiScheduleRunId,
                status: rawStatus,
            });
        }
    }
    async callsFor(scope, before, take) {
        const rows = await this.prisma.aiCall.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                ...(before ? { startedAt: { lt: before } } : {}),
            },
            orderBy: { startedAt: 'desc' },
            take,
            include: {
                contact: { select: { name: true } },
                customer: { select: { name: true } },
            },
        });
        return rows.map(toCallView);
    }
    async recording(scope, id) {
        const call = await this.prisma.aiCall.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope) },
        });
        if (!call)
            throw new common_1.NotFoundException('Call not found');
        let sid = call.recordingSid;
        if (!sid && !call.recordingKey) {
            const list = await this.signalwire.listRecordings(call.callSid);
            sid = list.find((r) => r.status !== 'absent')?.sid ?? null;
            if (sid) {
                await this.prisma.aiCall.update({
                    where: { id: call.id },
                    data: { recordingSid: sid },
                });
            }
        }
        if (sid) {
            return {
                body: await this.signalwire.fetchRecording(sid),
                contentType: 'audio/mpeg',
                filename: `call-${call.id}.mp3`,
            };
        }
        if (call.recordingKey) {
            return {
                body: await this.storage.getBuffer(call.recordingKey),
                contentType: 'audio/wav',
                filename: `call-${call.id}.wav`,
            };
        }
        throw new common_1.NotFoundException('This call has no recording');
    }
};
exports.VoiceCallsService = VoiceCallsService;
exports.VoiceCallsService = VoiceCallsService = VoiceCallsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, common_1.Optional)()),
    __param(5, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        signalwire_client_1.SignalWireClient,
        object_storage_service_1.ObjectStorageService,
        assistant_tools_1.AssistantTools,
        customer_outbox_service_1.CustomerOutbox])
], VoiceCallsService);
function toCallView(c) {
    const inbound = c.direction === 'INBOUND';
    const thirdParty = c.purpose === 'THIRD_PARTY';
    const contactName = thirdParty ? (c.contact?.name ?? null) : null;
    return {
        id: c.id,
        direction: c.direction,
        purpose: c.purpose,
        status: c.status,
        startedAt: c.startedAt.toISOString(),
        answeredAt: c.answeredAt?.toISOString() ?? null,
        endedAt: c.endedAt?.toISOString() ?? null,
        fromNumber: inbound ? c.peer : c.fromNumber,
        toNumber: inbound ? c.fromNumber : c.peer,
        withName: thirdParty
            ? (contactName ?? c.peer)
            : c.customer?.name?.trim() || 'you',
        contactName,
        durationSec: c.durationSec,
        hasRecording: !!c.recordingSid ||
            !!c.recordingKey ||
            (c.status === 'COMPLETED' && !!c.answeredAt),
    };
}
//# sourceMappingURL=voice-calls.service.js.map