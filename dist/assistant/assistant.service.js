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
var AssistantService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantService = exports.CHAT_READ_WAIT_MS = exports.FAILED_REPLY = exports.VOICE_HISTORY = exports.HISTORY = exports.MAX_TOOL_ROUNDS = void 0;
exports.fileContext = fileContext;
exports.toMessageView = toMessageView;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const reach_1 = require("../messaging/reach");
const ai_usage_context_1 = require("../ai/ai-usage.context");
const openai_client_1 = require("../ai/openai.client");
const attachment_processor_service_1 = require("../bookkeeping/attachment-processor.service");
const attachments_service_1 = require("../bookkeeping/attachments.service");
const scope_1 = require("../bookkeeping/scope");
const prisma_service_1 = require("../prisma/prisma.service");
const assistant_tools_1 = require("./assistant-tools");
const assistant_prompt_1 = require("./assistant-prompt");
const communications_history_service_1 = require("./communications-history.service");
const instructions_service_1 = require("./instructions.service");
const links_util_1 = require("./links.util");
const rules_service_1 = require("./rules.service");
const voice_notes_util_1 = require("./voice-notes.util");
const change_feed_1 = require("./change-feed");
exports.MAX_TOOL_ROUNDS = 6;
exports.HISTORY = 20;
exports.VOICE_HISTORY = 10;
exports.FAILED_REPLY = "Sorry — I couldn't answer that right now. Please try again in a minute.";
exports.CHAT_READ_WAIT_MS = 75_000;
function fileContext(a) {
    return {
        id: a.id,
        filename: a.filename,
        type: a.reading?.documentType ?? a.kind,
        status: a.status,
        whatItIs: a.reading?.summary ?? null,
        total: a.total,
        date: a.reading?.date ?? null,
        payee: a.reading?.payee ?? a.reading?.vendor ?? null,
        filedTo: a.transaction
            ? {
                id: a.transaction.id,
                name: a.transaction.name ?? a.transaction.description,
                amount: a.transaction.amount,
                date: a.transaction.date,
            }
            : null,
        note: a.matchNote ?? a.error,
        ...(a.reading?.transcript ? { voiceNote: true } : {}),
    };
}
function toMessageView(m) {
    return {
        id: m.id,
        role: m.role === 'USER' ? 'USER' : 'ASSISTANT',
        channel: m.channel,
        text: m.text,
        warning: m.warning,
        actions: Array.isArray(m.actions)
            ? m.actions
            : null,
        createdAt: m.createdAt.toISOString(),
    };
}
const SCHEDULED_NOTE = 'This is a SCHEDULED message the customer asked for: the user message below is the ' +
    'task they set. Look the data up with your tools and write the message itself, ready to ' +
    'send — no questions, no "let me know", no greeting beyond one short line. You cannot ' +
    'change anything in this run. If there is nothing to report, say so in one line.';
function historyText(m) {
    const actions = Array.isArray(m.actions)
        ? m.actions
        : [];
    const done = actions.filter((a) => a.ok).map((a) => a.summary);
    return done.length ? `${m.text}\n[Done: ${done.join('; ')}]` : m.text;
}
let AssistantService = AssistantService_1 = class AssistantService {
    prisma;
    config;
    openai;
    tools;
    rules;
    attachments;
    processor;
    instructions;
    history;
    logger = new common_1.Logger(AssistantService_1.name);
    constructor(prisma, config, openai, tools, rules, attachments, processor, instructions, history) {
        this.prisma = prisma;
        this.config = config;
        this.openai = openai;
        this.tools = tools;
        this.rules = rules;
        this.attachments = attachments;
        this.processor = processor;
        this.instructions = instructions;
        this.history = history;
    }
    get enabled() {
        return this.config.get('AI_ASSISTANT')?.trim() === '1';
    }
    assertEnabled() {
        if (!this.enabled)
            throw new common_1.ForbiddenException('The AI assistant is not turned on');
    }
    model() {
        return (this.config.get('OPENAI_ASSISTANT_MODEL')?.trim() || 'gpt-4.1');
    }
    dailyLimit() {
        const n = Number(this.config.get('ASSISTANT_DAILY_LIMIT'));
        return Number.isFinite(n) && n > 0 ? n : 100;
    }
    async chat(scope, text, conversationId, attachmentIds = []) {
        this.assertEnabled();
        const ids = [...new Set(attachmentIds)].slice(0, 10);
        for (const id of ids)
            await this.attachments.get(scope, id);
        const typed = text.trim() || (ids.length ? this.fileLabel(ids.length) : '');
        if (!typed)
            throw new common_1.BadRequestException('Write a message or add a file');
        const conversation = conversationId
            ? await this.ownConversation(scope, conversationId)
            : await this.prisma.aiConversation.create({
                data: {
                    ...(0, scope_1.scopeWhere)(scope),
                    channel: 'BOT',
                    title: typed.slice(0, 60),
                },
            });
        if (!ids.length)
            return this.respond(conversation, typed);
        await this.prisma.transactionAttachment.updateMany({
            where: { id: { in: ids }, ...(0, scope_1.scopeWhere)(scope), source: 'UPLOAD' },
            data: { source: 'CHAT' },
        });
        await this.processor.waitUntilRead(ids, exports.CHAT_READ_WAIT_MS);
        const all = await this.processor.family(ids);
        const { words, files } = await this.filesMessage(scope, text, all, ids.length);
        return this.respond(conversation, words, { attachmentIds: all, files });
    }
    fileLabel(n) {
        return n === 1 ? '[sent a file]' : `[sent ${n} files]`;
    }
    async filesMessage(scope, text, ids, sent = ids.length) {
        const views = [];
        for (const id of ids) {
            try {
                views.push(await this.attachments.get(scope, id));
            }
            catch {
            }
        }
        const spoken = (0, voice_notes_util_1.spokenMessage)(text, views);
        return {
            words: spoken.words || this.fileLabel(sent),
            files: spoken.files.map(fileContext),
        };
    }
    async attachmentMessages(scope, attachmentId) {
        const links = await this.prisma.aiMessageAttachment.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), attachmentId },
            select: { messageId: true },
        });
        if (!links.length)
            return [];
        const linked = await this.prisma.aiMessage.findMany({
            where: { id: { in: links.map((l) => l.messageId) } },
            select: { id: true, conversationId: true, role: true },
        });
        const ids = new Set(linked.map((m) => m.id));
        for (const m of linked.filter((x) => x.role === 'USER')) {
            const next = await this.prisma.aiMessage.findFirst({
                where: { conversationId: m.conversationId, id: { gt: m.id } },
                orderBy: { id: 'asc' },
                select: { id: true, role: true },
            });
            if (next?.role === 'ASSISTANT')
                ids.add(next.id);
        }
        const rows = await this.prisma.aiMessage.findMany({
            where: { id: { in: [...ids] }, ...(0, scope_1.scopeWhere)(scope) },
            orderBy: { id: 'asc' },
            take: 200,
        });
        return this.withFiles(rows);
    }
    async withFiles(rows) {
        if (!rows.length)
            return [];
        const links = await this.prisma.aiMessageAttachment.findMany({
            where: { messageId: { in: rows.map((m) => m.id) } },
            select: { messageId: true, attachmentId: true, role: true },
            orderBy: { id: 'asc' },
        });
        const files = links.length
            ? await this.prisma.transactionAttachment.findMany({
                where: { id: { in: [...new Set(links.map((l) => l.attachmentId))] } },
                select: { id: true, filename: true, deletedAt: true },
            })
            : [];
        const byId = new Map(files.map((f) => [f.id, f]));
        return rows.map((m) => {
            const mine = links.filter((l) => l.messageId === m.id);
            return {
                ...toMessageView(m),
                files: mine.map((l) => {
                    const f = byId.get(l.attachmentId);
                    return {
                        id: l.attachmentId,
                        filename: f?.filename ?? 'File',
                        role: l.role,
                        live: !!f && !f.deletedAt,
                    };
                }),
            };
        });
    }
    async attachmentThread(scope, attachmentId) {
        await this.attachments.get(scope, attachmentId);
        const c = await this.prisma.aiConversation.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), channel: 'BOT', attachmentId },
            orderBy: { id: 'desc' },
        });
        return {
            conversationId: c?.id ?? null,
            messages: c ? await this.messages(scope, c.id) : [],
        };
    }
    async attachmentChat(scope, attachmentId, text) {
        this.assertEnabled();
        const file = await this.attachments.get(scope, attachmentId);
        const conversation = (await this.prisma.aiConversation.findFirst({
            where: { ...(0, scope_1.scopeWhere)(scope), channel: 'BOT', attachmentId },
            orderBy: { id: 'desc' },
        })) ??
            (await this.prisma.aiConversation.create({
                data: {
                    ...(0, scope_1.scopeWhere)(scope),
                    channel: 'BOT',
                    attachmentId,
                    title: `About ${file.filename}`.slice(0, 120),
                },
            }));
        return this.respond(conversation, text, {
            attachment: {
                id: file.id,
                filename: file.filename,
                kind: file.kind,
                status: file.status,
                whyNotMatched: file.matchNote ?? file.error,
                reading: file.reading,
                total: file.total,
                texted: file.message,
                attachedTo: file.transaction,
            },
        });
    }
    async conversations(scope) {
        const rows = await this.prisma.aiConversation.findMany({
            where: (0, scope_1.scopeWhere)(scope),
            orderBy: { lastMessageAt: 'desc' },
            take: 100,
            include: {
                messages: { orderBy: { id: 'desc' }, take: 1, select: { text: true } },
            },
        });
        return rows.map((c) => ({
            id: c.id,
            channel: c.channel,
            title: c.title,
            peer: c.peer,
            attachmentId: c.attachmentId,
            lastMessageAt: c.lastMessageAt.toISOString(),
            preview: c.messages[0]?.text.slice(0, 120) ?? null,
        }));
    }
    async messages(scope, conversationId) {
        await this.ownConversation(scope, conversationId);
        const rows = await this.prisma.aiMessage.findMany({
            where: { conversationId },
            orderBy: { id: 'asc' },
            take: 500,
        });
        return this.withFiles(rows);
    }
    async ownConversation(scope, id) {
        const c = await this.prisma.aiConversation.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope) },
        });
        if (!c)
            throw new common_1.NotFoundException('Conversation not found');
        return c;
    }
    async respond(conversation, text, opts = {}) {
        const scope = (0, scope_1.scopeOf)(conversation);
        const history = await this.prisma.aiMessage.findMany({
            where: { conversationId: conversation.id },
            orderBy: { id: 'desc' },
            take: exports.HISTORY,
        });
        const message = await this.save(conversation, 'USER', text, {
            attachmentIds: opts.attachmentIds,
        });
        let answer;
        if (await this.overLimit(scope.customerId)) {
            answer = {
                text: "You've reached today's limit for the assistant. It will answer again tomorrow.",
                actions: [],
                warning: null,
                touched: [],
            };
        }
        else {
            answer = await this.run(scope, conversation, message.id, text, history.reverse(), opts.attachment, opts.files);
        }
        const current = (await this.prisma.aiConversation.findUnique({
            where: { id: conversation.id },
        })) ?? conversation;
        const reply = await this.save(current, 'ASSISTANT', answer.text, {
            actions: answer.actions,
            warning: answer.warning,
            actedOn: answer.touched,
        });
        const [m, r] = await this.withFiles([message, reply]);
        return { conversationId: conversation.id, message: m, reply: r };
    }
    run(scope, conversation, messageId, text, history, attachment, files) {
        return (0, ai_usage_context_1.withAiUsage)({
            ...scope,
            feature: 'ASSISTANT',
        }, () => this.runChat(scope, conversation, messageId, text, history, attachment, files));
    }
    async runChat(scope, conversation, messageId, text, history, attachment, files) {
        const channel = conversation.channel;
        const tools = (0, assistant_tools_1.toolsFor)(channel);
        const links = new Map();
        const done = {
            text: '',
            actions: [],
            warning: null,
            touched: [],
        };
        try {
            const messages = [
                {
                    role: 'system',
                    content: await this.promptFor(conversation, { attachment, files }),
                },
                ...history.map((m) => m.role === 'USER'
                    ? { role: 'user', content: m.text }
                    : { role: 'assistant', content: historyText(m) }),
                { role: 'user', content: text },
            ];
            return await this.loop(messages, tools, { scope, messageId, conversation, links }, done);
        }
        catch (err) {
            this.logger.warn(`assistant customer ${scope.customerId} failed: ${err instanceof Error ? err.message : err}`);
        }
        return { ...done, text: exports.FAILED_REPLY };
    }
    followUp(conversation, note, channel) {
        const scope = (0, scope_1.scopeOf)(conversation);
        return (0, ai_usage_context_1.withAiUsage)({ ...scope, feature: 'ASSISTANT' }, async () => {
            try {
                const history = await this.prisma.aiMessage.findMany({
                    where: { conversationId: conversation.id },
                    orderBy: { id: 'desc' },
                    take: exports.HISTORY,
                });
                const messages = [
                    { role: 'system', content: await this.promptFor(conversation) },
                    ...history
                        .reverse()
                        .map((m) => m.role === 'USER'
                        ? { role: 'user', content: m.text }
                        : { role: 'assistant', content: historyText(m) }),
                    {
                        role: 'user',
                        content: `[From CYG Finance, not the customer: ${note} Your answer is sent to them as a ${channel === 'SMS' ? 'text message' : 'email'} — plain text, short, no phone-call style.]`,
                    },
                ];
                const lastUser = history.find((m) => m.role === 'USER');
                const out = await this.loop(messages, (0, assistant_tools_1.toolsFor)(channel), {
                    scope,
                    messageId: lastUser?.id ?? null,
                    conversation,
                    links: new Map(),
                });
                if (out.text === exports.FAILED_REPLY)
                    return null;
                const current = (await this.prisma.aiConversation.findUnique({
                    where: { id: conversation.id },
                })) ?? conversation;
                await this.save(current, 'ASSISTANT', out.text, {
                    actions: out.actions,
                    warning: out.warning,
                    actedOn: out.touched,
                });
                return out;
            }
            catch (err) {
                this.logger.warn(`follow-up for conversation ${conversation.id} failed: ${err instanceof Error ? err.message : err}`);
                return null;
            }
        });
    }
    async loop(messages, tools, ctx, acc = { text: '', actions: [], warning: null, touched: [] }) {
        const { actions, touched } = acc;
        for (let round = 0; round <= exports.MAX_TOOL_ROUNDS; round++) {
            const last = round === exports.MAX_TOOL_ROUNDS;
            const reply = await this.openai.chatMessages({
                model: this.model(),
                messages,
                tools: last ? undefined : tools,
                maxTokens: 1200,
                timeoutMs: 90_000,
            });
            if (!reply.toolCalls.length || last) {
                const said = reply.content?.trim();
                return {
                    text: said
                        ? (0, links_util_1.fillLinks)(said, ctx.links)
                        : actions.length
                            ? 'Done.'
                            : exports.FAILED_REPLY,
                    actions,
                    warning: acc.warning,
                    touched,
                };
            }
            messages.push({
                role: 'assistant',
                content: reply.content,
                toolCalls: reply.toolCalls,
            });
            for (const call of reply.toolCalls) {
                const outcome = await this.tools.run(call.name, call.arguments, ctx);
                if (outcome.action)
                    actions.push(outcome.action);
                if (outcome.warning)
                    acc.warning = outcome.warning;
                if (outcome.attachmentId)
                    touched.push(outcome.attachmentId);
                messages.push({
                    role: 'tool',
                    toolCallId: call.id,
                    content: outcome.content,
                });
            }
        }
        return { ...acc, text: exports.FAILED_REPLY };
    }
    runTask(scope, task, channel) {
        return (0, ai_usage_context_1.withAiUsage)({
            ...scope,
            feature: 'SCHEDULE',
        }, async () => {
            try {
                const prompt = (0, assistant_prompt_1.systemPrompt)({
                    channel,
                    today: new Date().toISOString().slice(0, 10),
                    bookLabel: await this.bookLabel(scope),
                    rules: await this.rules.promptBlock(scope),
                    preferredContact: await this.preferredContact(scope.customerId),
                    reach: await (0, reach_1.firmReach)(this.prisma, this.config).catch(() => null),
                }, await this.instructions?.assistant());
                const messages = [
                    { role: 'system', content: `${prompt}\n\n${SCHEDULED_NOTE}` },
                    { role: 'user', content: task },
                ];
                const out = await this.loop(messages, assistant_tools_1.READ_TOOLS, {
                    scope,
                    messageId: null,
                    links: new Map(),
                });
                return out.text === exports.FAILED_REPLY ? null : out.text;
            }
            catch (err) {
                this.logger.warn(`scheduled task for customer ${scope.customerId} failed: ${err instanceof Error ? err.message : err}`);
                return null;
            }
        });
    }
    async promptFor(conversation, extra = {}) {
        const scope = (0, scope_1.scopeOf)(conversation);
        const prompt = (0, assistant_prompt_1.systemPrompt)({
            channel: conversation.channel,
            today: new Date().toISOString().slice(0, 10),
            bookLabel: await this.bookLabel(scope),
            rules: await this.rules.promptBlock(scope),
            preferredContact: await this.preferredContact(scope.customerId),
            reach: await (0, reach_1.firmReach)(this.prisma, this.config).catch(() => null),
            nameUnknown: await this.nameUnknown(scope.customerId),
            attachment: extra.attachment,
            files: extra.files,
        }, await this.instructions?.assistant());
        const parts = [prompt];
        const elsewhere = await this.history?.otherChannels(conversation);
        if (elsewhere)
            parts.push(elsewhere);
        if (conversation.channel === 'VOICE') {
            const earlier = await this.history?.recentTurns(conversation.id, exports.VOICE_HISTORY);
            if (earlier) {
                parts.push(`EARLIER CALLS ON THIS PHONE LINE (oldest first):\n${earlier}`);
            }
        }
        if (extra.note)
            parts.push(extra.note);
        return parts.join('\n\n');
    }
    isOverLimit(customerId) {
        return this.overLimit(customerId);
    }
    async overLimit(customerId) {
        const since = new Date();
        since.setUTCHours(0, 0, 0, 0);
        const count = await this.prisma.aiMessage.count({
            where: { customerId, role: 'USER', createdAt: { gte: since } },
        });
        return count > this.dailyLimit();
    }
    async nameUnknown(customerId) {
        const c = await this.prisma.customer
            .findUnique({ where: { id: customerId }, select: { name: true } })
            .catch(() => null);
        return !!c && !c.name.trim();
    }
    async preferredContact(customerId) {
        try {
            const c = await this.prisma.customer.findUnique({
                where: { id: customerId },
                select: { preferredContact: true },
            });
            return c?.preferredContact ?? null;
        }
        catch {
            return null;
        }
    }
    async bookLabel(scope) {
        const book = await this.prisma.book.findUnique({
            where: { id: scope.bookId },
            select: { name: true },
        });
        const name = book?.name ?? 'this company';
        return scope.companyId === null
            ? `the books of their company "${name}"`
            : `the books of their registered business "${name}"`;
    }
    async save(conversation, role, text, extra = {}) {
        const [row] = await this.prisma.$transaction([
            this.prisma.aiMessage.create({
                data: {
                    conversationId: conversation.id,
                    customerId: conversation.customerId,
                    bookId: conversation.bookId,
                    companyId: conversation.companyId,
                    channel: conversation.channel,
                    role,
                    text: text.slice(0, 20_000),
                    ...(extra.actions?.length && {
                        actions: extra.actions,
                    }),
                    warning: extra.warning ?? null,
                    ...(extra.attachmentIds?.length && {
                        attachmentIds: extra.attachmentIds,
                    }),
                },
            }),
            this.prisma.aiConversation.update({
                where: { id: conversation.id },
                data: { lastMessageAt: new Date() },
            }),
        ]);
        await this.link(row, conversation, extra.attachmentIds, extra.actedOn);
        if (extra.actions?.some((a) => a.ok))
            change_feed_1.changeFeed.bump(conversation.customerId);
        return row;
    }
    async link(row, conversation, sent = [], acted = []) {
        const links = new Map();
        for (const id of acted)
            if (id > 0)
                links.set(id, 'ACTION');
        if (conversation.attachmentId)
            links.set(conversation.attachmentId, 'ABOUT');
        for (const id of sent)
            if (id > 0)
                links.set(id, 'SENT');
        if (!links.size)
            return;
        try {
            await this.prisma.aiMessageAttachment.createMany({
                data: [...links].map(([attachmentId, role]) => ({
                    messageId: row.id,
                    attachmentId,
                    customerId: row.customerId,
                    bookId: row.bookId,
                    companyId: row.companyId,
                    role,
                })),
                skipDuplicates: true,
            });
        }
        catch (err) {
            this.logger.warn(`message #${row.id}: attachment links not saved: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
};
exports.AssistantService = AssistantService;
exports.AssistantService = AssistantService = AssistantService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(7, (0, common_1.Optional)()),
    __param(8, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        openai_client_1.OpenAiClient,
        assistant_tools_1.AssistantTools,
        rules_service_1.RulesService,
        attachments_service_1.AttachmentsService,
        attachment_processor_service_1.AttachmentProcessorService,
        instructions_service_1.InstructionsService,
        communications_history_service_1.CommunicationsHistory])
], AssistantService);
//# sourceMappingURL=assistant.service.js.map