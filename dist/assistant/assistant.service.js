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
var AssistantService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantService = exports.FAILED_REPLY = exports.HISTORY = exports.MAX_TOOL_ROUNDS = void 0;
exports.toMessageView = toMessageView;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const openai_client_1 = require("../ai/openai.client");
const attachments_service_1 = require("../bookkeeping/attachments.service");
const scope_1 = require("../bookkeeping/scope");
const prisma_service_1 = require("../prisma/prisma.service");
const assistant_tools_1 = require("./assistant-tools");
const assistant_prompt_1 = require("./assistant-prompt");
const rules_service_1 = require("./rules.service");
exports.MAX_TOOL_ROUNDS = 6;
exports.HISTORY = 20;
exports.FAILED_REPLY = "Sorry — I couldn't answer that right now. Please try again in a minute.";
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
    logger = new common_1.Logger(AssistantService_1.name);
    constructor(prisma, config, openai, tools, rules, attachments) {
        this.prisma = prisma;
        this.config = config;
        this.openai = openai;
        this.tools = tools;
        this.rules = rules;
        this.attachments = attachments;
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
    async chat(scope, text, conversationId) {
        this.assertEnabled();
        const conversation = conversationId
            ? await this.ownConversation(scope, conversationId)
            : await this.prisma.aiConversation.create({
                data: {
                    ...(0, scope_1.scopeWhere)(scope),
                    channel: 'BOT',
                    title: text.slice(0, 60),
                },
            });
        return this.respond(conversation, text);
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
        return rows.map(toMessageView);
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
        const channel = conversation.channel;
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
            };
        }
        else {
            answer = await this.run(scope, channel, message.id, text, history.reverse(), opts.attachment);
        }
        const reply = await this.save(conversation, 'ASSISTANT', answer.text, {
            actions: answer.actions,
            warning: answer.warning,
        });
        return {
            conversationId: conversation.id,
            message: toMessageView(message),
            reply: toMessageView(reply),
        };
    }
    async run(scope, channel, messageId, text, history, attachment) {
        const actions = [];
        let warning = null;
        try {
            const messages = [
                {
                    role: 'system',
                    content: (0, assistant_prompt_1.systemPrompt)({
                        channel,
                        today: new Date().toISOString().slice(0, 10),
                        bookLabel: await this.bookLabel(scope),
                        rules: await this.rules.promptBlock(scope),
                        preferredContact: await this.preferredContact(scope.customerId),
                        attachment,
                    }),
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
                    tools: last ? undefined : assistant_tools_1.ASSISTANT_TOOLS,
                    maxTokens: 1200,
                    timeoutMs: 90_000,
                });
                if (!reply.toolCalls.length || last) {
                    return {
                        text: reply.content?.trim() ||
                            (actions.length ? 'Done.' : exports.FAILED_REPLY),
                        actions,
                        warning,
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
                    });
                    if (outcome.action)
                        actions.push(outcome.action);
                    if (outcome.warning)
                        warning = outcome.warning;
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
        return { text: exports.FAILED_REPLY, actions, warning };
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
        return row;
    }
};
exports.AssistantService = AssistantService;
exports.AssistantService = AssistantService = AssistantService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        openai_client_1.OpenAiClient,
        assistant_tools_1.AssistantTools,
        rules_service_1.RulesService,
        attachments_service_1.AttachmentsService])
], AssistantService);
//# sourceMappingURL=assistant.service.js.map