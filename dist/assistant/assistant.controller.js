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
exports.IntakeController = exports.AttachmentChatController = exports.AssistantController = exports.AssistantConfigController = void 0;
const common_1 = require("@nestjs/common");
const customer_jwt_guard_1 = require("../customer-auth/customer-jwt.guard");
const book_scope_guard_1 = require("../bookkeeping/book-scope.guard");
const assistant_service_1 = require("./assistant.service");
const assistant_dto_1 = require("./dto/assistant.dto");
const intake_agent_guard_1 = require("./intake-agent.guard");
const intake_agent_service_1 = require("./intake-agent.service");
const rules_service_1 = require("./rules.service");
let AssistantConfigController = class AssistantConfigController {
    assistant;
    constructor(assistant) {
        this.assistant = assistant;
    }
    config() {
        return { enabled: this.assistant.enabled };
    }
};
exports.AssistantConfigController = AssistantConfigController;
__decorate([
    (0, common_1.Get)('config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], AssistantConfigController.prototype, "config", null);
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