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
const ai_contacts_module_1 = require("../ai-contacts/ai-contacts.module");
const bookkeeping_module_1 = require("../bookkeeping/bookkeeping.module");
const customer_auth_module_1 = require("../customer-auth/customer-auth.module");
const messaging_module_1 = require("../messaging/messaging.module");
const ai_schedules_store_1 = require("../schedules/ai-schedules.store");
const assistant_controller_1 = require("./assistant.controller");
const contact_relay_service_1 = require("./contact-relay.service");
const assistant_service_1 = require("./assistant.service");
const assistant_tools_1 = require("./assistant-tools");
const communications_history_service_1 = require("./communications-history.service");
const customer_outbox_service_1 = require("./customer-outbox.service");
const intake_agent_guard_1 = require("./intake-agent.guard");
const intake_agent_service_1 = require("./intake-agent.service");
const strong_ai_service_1 = require("./strong-ai.service");
let AssistantModule = class AssistantModule {
};
exports.AssistantModule = AssistantModule;
exports.AssistantModule = AssistantModule = __decorate([
    (0, common_1.Module)({
        imports: [
            ai_contacts_module_1.AiContactsModule,
            bookkeeping_module_1.BookkeepingModule,
            customer_auth_module_1.CustomerAuthModule,
            messaging_module_1.MessagingModule,
        ],
        controllers: [
            assistant_controller_1.AssistantConfigController,
            assistant_controller_1.AssistantController,
            assistant_controller_1.AttachmentChatController,
            assistant_controller_1.ContactReplyController,
            assistant_controller_1.IntakeController,
        ],
        providers: [
            assistant_service_1.AssistantService,
            assistant_tools_1.AssistantTools,
            ai_schedules_store_1.AiSchedulesStore,
            communications_history_service_1.CommunicationsHistory,
            contact_relay_service_1.ContactRelayService,
            customer_outbox_service_1.CustomerOutbox,
            intake_agent_guard_1.IntakeAgentGuard,
            intake_agent_service_1.IntakeAgentService,
            openai_client_1.OpenAiClient,
            strong_ai_service_1.StrongAiService,
        ],
        exports: [
            assistant_service_1.AssistantService,
            assistant_tools_1.AssistantTools,
            ai_schedules_store_1.AiSchedulesStore,
            communications_history_service_1.CommunicationsHistory,
            customer_outbox_service_1.CustomerOutbox,
        ],
    })
], AssistantModule);
//# sourceMappingURL=assistant.module.js.map