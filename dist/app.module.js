"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const schedule_1 = require("@nestjs/schedule");
const ai_contacts_module_1 = require("./ai-contacts/ai-contacts.module");
const ai_usage_module_1 = require("./ai-usage/ai-usage.module");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const assistant_module_1 = require("./assistant/assistant.module");
const bank_feeds_module_1 = require("./bank-feeds/bank-feeds.module");
const billing_module_1 = require("./billing/billing.module");
const bookkeeping_module_1 = require("./bookkeeping/bookkeeping.module");
const comm_usage_module_1 = require("./comm-usage/comm-usage.module");
const contact_module_1 = require("./contact/contact.module");
const customer_auth_module_1 = require("./customer-auth/customer-auth.module");
const feature_requests_module_1 = require("./feature-requests/feature-requests.module");
const mail_module_1 = require("./mail/mail.module");
const prisma_module_1 = require("./prisma/prisma.module");
const schedules_module_1 = require("./schedules/schedules.module");
const sales_module_1 = require("./sales/sales.module");
const voice_module_1 = require("./voice/voice.module");
const storage_module_1 = require("./storage/storage.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            schedule_1.ScheduleModule.forRoot(),
            prisma_module_1.PrismaModule,
            ai_usage_module_1.AiUsageModule,
            comm_usage_module_1.CommUsageModule,
            storage_module_1.StorageModule,
            mail_module_1.MailModule,
            contact_module_1.ContactModule,
            customer_auth_module_1.CustomerAuthModule,
            bookkeeping_module_1.BookkeepingModule,
            billing_module_1.BillingModule,
            ai_contacts_module_1.AiContactsModule,
            assistant_module_1.AssistantModule,
            bank_feeds_module_1.BankFeedsModule,
            schedules_module_1.SchedulesModule,
            feature_requests_module_1.FeatureRequestsModule,
            sales_module_1.SalesModule,
            voice_module_1.VoiceModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [app_service_1.AppService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map