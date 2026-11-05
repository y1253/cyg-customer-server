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
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntakeController = exports.ContactReplyController = exports.StatementChatController = exports.AttachmentChatController = exports.DictationController = exports.AssistantController = exports.AssistantConfigController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const customer_jwt_guard_1 = require("../customer-auth/customer-jwt.guard");
const book_scope_guard_1 = require("../bookkeeping/book-scope.guard");
const assistant_service_1 = require("./assistant.service");
const assistant_dto_1 = require("./dto/assistant.dto");
const intake_system_guard_1 = require("../customer-auth/intake-system.guard");
const contact_relay_service_1 = require("./contact-relay.service");
const intake_agent_guard_1 = require("./intake-agent.guard");
const intake_agent_service_1 = require("./intake-agent.service");
const rules_service_1 = require("./rules.service");
const change_feed_1 = require("./change-feed");
const openai_client_1 = require("../ai/openai.client");
const ai_usage_context_1 = require("../ai/ai-usage.context");
const transcript_hygiene_util_1 = require("../ai/transcript-hygiene.util");
const transcribe_upload_1 = require("../ai/transcribe-upload");
let AssistantConfigController = class AssistantConfigController {
    assistant;
    constructor(assistant) {
        this.assistant = assistant;
    }
    config() {
        return { enabled: this.assistant.enabled };
    }
    changes(req) {
        return { version: change_feed_1.changeFeed.version(req.user.customerId) };
    }
};
exports.AssistantConfigController = AssistantConfigController;
__decorate([
    (0, common_1.Get)('config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], AssistantConfigController.prototype, "config", null);
__decorate([
    (0, common_1.Get)('changes'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], AssistantConfigController.prototype, "changes", null);
exports.AssistantConfigController = AssistantConfigController = __decorate([
    (0, common_1.Controller)('assistant'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard),
    __metadata("design:paramtypes", [assistant_service_1.AssistantService])
], AssistantConfigController);
let AssistantController = class AssistantController {
    assistant;
    rules;
    constructor(assistant, rules) {
        this.assistant = assistant;
        this.rules = rules;
    }
    chat(scope, dto) {
        return this.assistant.chat(scope, dto.text, dto.conversationId, dto.attachmentIds ?? []);
    }
    conversations(scope) {
        return this.assistant.conversations(scope);
    }
    messages(scope, id) {
        return this.assistant.messages(scope, id);
    }
    listRules(scope) {
        return this.rules.listCustomerRules(scope);
    }
    async deleteRule(scope, id) {
        await this.rules.deleteCustomerRule(scope, id);
        return { ok: true };
    }
};
exports.AssistantController = AssistantController;
__decorate([
    (0, common_1.Post)('chat'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, assistant_dto_1.ChatDto]),
    __metadata("design:returntype", Promise)
], AssistantController.prototype, "chat", null);
__decorate([
    (0, common_1.Get)('conversations'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AssistantController.prototype, "conversations", null);
__decorate([
    (0, common_1.Get)('conversations/:id/messages'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], AssistantController.prototype, "messages", null);
__decorate([
    (0, common_1.Get)('rules'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AssistantController.prototype, "listRules", null);
__decorate([
    (0, common_1.Delete)('rules/:id'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], AssistantController.prototype, "deleteRule", null);
exports.AssistantController = AssistantController = __decorate([
    (0, common_1.Controller)('assistant'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard, book_scope_guard_1.BookScopeGuard),
    __metadata("design:paramtypes", [assistant_service_1.AssistantService,
        rules_service_1.RulesService])
], AssistantController);
let DictationController = class DictationController {
    assistant;
    openai;
    constructor(assistant, openai) {
        this.assistant = assistant;
        this.openai = openai;
    }
    async transcribe(scope, file) {
        if (!this.assistant.enabled) {
            throw new common_1.BadRequestException('The assistant is switched off.');
        }
        if (!file)
            throw new common_1.BadRequestException('No recording was uploaded.');
        const text = await (0, ai_usage_context_1.withAiUsage)({ ...scope, feature: 'TRANSCRIBE' }, () => this.openai.transcribe(file.buffer, file.originalname || 'dictation.webm', file.mimetype));
        return { text: (0, transcript_hygiene_util_1.isHallucinatedTranscript)(text) ? '' : text };
    }
};
exports.DictationController = DictationController;
__decorate([
    (0, common_1.Post)('transcribe'),
    (0, common_1.HttpCode)(200),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        limits: { fileSize: transcribe_upload_1.MAX_TRANSCRIBE_BYTES, files: 1 },
        fileFilter: transcribe_upload_1.transcribeFileFilter,
    })),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], DictationController.prototype, "transcribe", null);
exports.DictationController = DictationController = __decorate([
    (0, common_1.Controller)('assistant'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard, book_scope_guard_1.BookScopeGuard),
    __metadata("design:paramtypes", [assistant_service_1.AssistantService,
        openai_client_1.OpenAiClient])
], DictationController);
let AttachmentChatController = class AttachmentChatController {
    assistant;
    constructor(assistant) {
        this.assistant = assistant;
    }
    thread(scope, id) {
        return this.assistant.attachmentThread(scope, id);
    }
    messages(scope, id) {
        return this.assistant.attachmentMessages(scope, id);
    }
    chat(scope, id, dto) {
        return this.assistant.attachmentChat(scope, id, dto.text);
    }
};
exports.AttachmentChatController = AttachmentChatController;
__decorate([
    (0, common_1.Get)(':id/chat'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", void 0)
], AttachmentChatController.prototype, "thread", null);
__decorate([
    (0, common_1.Get)(':id/messages'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], AttachmentChatController.prototype, "messages", null);
__decorate([
    (0, common_1.Post)(':id/chat'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, assistant_dto_1.AttachmentChatDto]),
    __metadata("design:returntype", Promise)
], AttachmentChatController.prototype, "chat", null);
exports.AttachmentChatController = AttachmentChatController = __decorate([
    (0, common_1.Controller)('bookkeeping/attachments'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard, book_scope_guard_1.BookScopeGuard),
    __metadata("design:paramtypes", [assistant_service_1.AssistantService])
], AttachmentChatController);
let StatementChatController = class StatementChatController {
    assistant;
    constructor(assistant) {
        this.assistant = assistant;
    }
    thread(scope, id) {
        return this.assistant.statementThread(scope, id);
    }
    chat(scope, id, dto) {
        return this.assistant.statementChat(scope, id, dto.text);
    }
};
exports.StatementChatController = StatementChatController;
__decorate([
    (0, common_1.Get)(':id/chat'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", void 0)
], StatementChatController.prototype, "thread", null);
__decorate([
    (0, common_1.Post)(':id/chat'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, assistant_dto_1.AttachmentChatDto]),
    __metadata("design:returntype", Promise)
], StatementChatController.prototype, "chat", null);
exports.StatementChatController = StatementChatController = __decorate([
    (0, common_1.Controller)('bookkeeping/statements'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard, book_scope_guard_1.BookScopeGuard),
    __metadata("design:paramtypes", [assistant_service_1.AssistantService])
], StatementChatController);
let ContactReplyController = class ContactReplyController {
    relay;
    constructor(relay) {
        this.relay = relay;
    }
    contactReply(dto) {
        return this.relay.relay(dto);
    }
};
exports.ContactReplyController = ContactReplyController;
__decorate([
    (0, common_1.Post)('contact-reply'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assistant_dto_1.ContactReplyDto]),
    __metadata("design:returntype", Promise)
], ContactReplyController.prototype, "contactReply", null);
exports.ContactReplyController = ContactReplyController = __decorate([
    (0, common_1.Controller)('intake-system'),
    (0, common_1.UseGuards)(intake_system_guard_1.IntakeSystemGuard),
    __metadata("design:paramtypes", [contact_relay_service_1.ContactRelayService])
], ContactReplyController);
let IntakeController = class IntakeController {
    intake;
    constructor(intake) {
        this.intake = intake;
    }
    route(customerId, dto) {
        return this.intake.route(customerId, dto.channel, dto.peer, dto.text);
    }
    agent(customerId, dto) {
        return this.intake.agent(customerId, {
            channel: dto.channel,
            peer: dto.peer,
            text: dto.text ?? null,
            attachmentIds: dto.attachmentIds,
            deliverable: dto.deliverable,
            replyFrom: dto.replyFrom ?? null,
        });
    }
};
exports.IntakeController = IntakeController;
__decorate([
    (0, common_1.Post)('route'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, intake_agent_guard_1.IntakeCustomer)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, assistant_dto_1.IntakeRouteDto]),
    __metadata("design:returntype", Promise)
], IntakeController.prototype, "route", null);
__decorate([
    (0, common_1.Post)('agent'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, intake_agent_guard_1.IntakeCustomer)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, assistant_dto_1.IntakeAgentDto]),
    __metadata("design:returntype", Promise)
], IntakeController.prototype, "agent", null);
exports.IntakeController = IntakeController = __decorate([
    (0, common_1.Controller)('intake'),
    (0, common_1.UseGuards)(intake_agent_guard_1.IntakeAgentGuard),
    __metadata("design:paramtypes", [intake_agent_service_1.IntakeAgentService])
], IntakeController);
//# sourceMappingURL=assistant.controller.js.map