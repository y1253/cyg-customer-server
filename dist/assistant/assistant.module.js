"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantModule = void 0;
const common_1 = require("@nestjs/common");
const openai_client_1 = require("../ai/openai.client");
const bookkeeping_module_1 = require("../bookkeeping/bookkeeping.module");
const customer_auth_module_1 = require("../customer-auth/customer-auth.module");
const messaging_module_1 = require("../messaging/messaging.module");
const assistant_controller_1 = require("./assistant.controller");
const assistant_service_1 = require("./assistant.service");
const assistant_tools_1 = require("./assistant-tools");
const intake_agent_guard_1 = require("./intake-agent.guard");
const intake_agent_service_1 = require("./intake-agent.service");
let AssistantModule = class AssistantModule {
};
exports.AssistantModule = AssistantModule;
exports.AssistantModule = AssistantModule = __decorate([
    (0, common_1.Module)({
        imports: [bookkeeping_module_1.BookkeepingModule, customer_auth_module_1.CustomerAuthModule, messaging_module_1.MessagingModule],
        controllers: [
            assistant_controller_1.AssistantConfigController,
            assistant_controller_1.AssistantController,
            assistant_controller_1.AttachmentChatController,
            assistant_controller_1.IntakeController,
        ],
        providers: [
            assistant_service_1.AssistantService,
            assistant_tools_1.AssistantTools,
            intake_agent_guard_1.IntakeAgentGuard,
            intake_agent_service_1.IntakeAgentService,
            openai_client_1.OpenAiClient,
        ],
        exports: [assistant_service_1.AssistantService, assistant_tools_1.AssistantTools],
    })
], AssistantModule);
//# sourceMappingURL=assistant.module.js.map