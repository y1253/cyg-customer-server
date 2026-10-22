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
exports.AssistantService = exports.CHAT_READ_WAIT_MS = exports.FAILED_REPLY = exports.HISTORY = exports.MAX_TOOL_ROUNDS = void 0;
exports.fileContext = fileContext;
exports.toMessageView = toMessageView;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const openai_client_1 = require("../ai/openai.client");
const attachment_processor_service_1 = require("../bookkeeping/attachment-processor.service");
const attachments_service_1 = require("../bookkeeping/attachments.service");
const scope_1 = require("../bookkeeping/scope");
const prisma_service_1 = require("../prisma/prisma.service");
const assistant_tools_1 = require("./assistant-tools");
const assistant_prompt_1 = require("./assistant-prompt");
const instructions_service_1 = require("./instructions.service");
const links_util_1 = require("./links.util");
const rules_service_1 = require("./rules.service");
const voice_notes_util_1 = require("./voice-notes.util");
exports.MAX_TOOL_ROUNDS = 6;
exports.HISTORY = 20;
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
    logger = new common_1.Logger(AssistantService_1.name);
    constructor(prisma, config, openai, tools, rules, attachments, processor, instructions) {
        this.prisma = prisma;
        this.config = config;
        this.openai = openai;
        this.tools = tools;
        this.rules = rules;
        this.attachments = attachments;
        this.processor = processor;
        this.instructions = instructions;
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
        const scope = {
            customerId: conversation.customerId,
            companyId: conversation.companyId,
        };
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
    async run(scope, conversation, messageId, text, history, attachment, files) {
        const channel = conversation.channel;
        const actions = [];
        const touched = [];
        const tools = (0, assistant_tools_1.toolsFor)(channel);
        const links = new Map();
        let warning = null;
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
                            ? (0, links_util_1.fillLinks)(said, links)
                            : actions.length
                                ? 'Done.'
                                : exports.FAILED_REPLY,
                        actions,
                        warning,
                        touched,
                    };
                }
                messages.push({
                    role: 'assistant',
                    content: reply.content,
                    toolCalls: reply.toolCalls,
                });
                for (const call of reply.toolCalls) {
                    const outcome = await this.tools.run(call.name, call.arguments, {
                        scope,
                        messageId,
                        conversation,
                        links,
                    });
                    if (outcome.action)
                        actions.push(outcome.action);
                    if (outcome.warning)
                        warning = outcome.warning;
                    if (outcome.attachmentId)
                        touched.push(outcome.attachmentId);
                    messages.push({
                        role: 'tool',
                        toolCallId: call.id,
                        content: outcome.content,
                    });
                }
            }
        }
        catch (err) {
            this.logger.warn(`assistant customer ${scope.customerId} failed: ${err instanceof Error ? err.message : err}`);
        }
        return { text: exports.FAILED_REPLY, actions, warning, touched };
    }
    async promptFor(conversation, extra = {}) {
        const scope = {
            customerId: conversation.customerId,
            companyId: conversation.companyId,
        };
        const prompt = (0, assistant_prompt_1.systemPrompt)({
            channel: conversation.channel,
            today: new Date().toISOString().slice(0, 10),
            bookLabel: await this.bookLabel(scope),
            rules: await this.rules.promptBlock(scope),
            preferredContact: await this.preferredContact(scope.customerId),
            attachment: extra.attachment,
            files: extra.files,
        }, await this.instructions?.assistant());
        return extra.note ? `${prompt}\n\n${extra.note}` : prompt;
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
        if (scope.companyId === null)
            return 'their personal / general books';
        const company = await this.prisma.company.findFirst({
            where: { id: scope.companyId },
            select: { businessName: true },
        });
        return `the books of their business "${company?.businessName ?? 'this business'}"`;
    }
    async save(conversation, role, text, extra = {}) {
        const [row] = await this.prisma.$transaction([
            this.prisma.aiMessage.create({
                data: {
                    conversationId: conversation.id,
                    customerId: conversation.customerId,
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
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        openai_client_1.OpenAiClient,
        assistant_tools_1.AssistantTools,
        rules_service_1.RulesService,
        attachments_service_1.AttachmentsService,
        attachment_processor_service_1.AttachmentProcessorService,
        instructions_service_1.InstructionsService])
], AssistantService);
//# sourceMappingURL=assistant.service.js.map