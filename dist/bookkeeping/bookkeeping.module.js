"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookkeepingModule = void 0;
const common_1 = require("@nestjs/common");
const openai_client_1 = require("../ai/openai.client");
const customer_auth_module_1 = require("../customer-auth/customer-auth.module");
const attachment_extractor_1 = require("./attachment-extractor");
const attachment_processor_service_1 = require("./attachment-processor.service");
const attachments_service_1 = require("./attachments.service");
const bookkeeping_controller_1 = require("./bookkeeping.controller");
const bookkeeping_service_1 = require("./bookkeeping.service");
const export_service_1 = require("./export.service");
const customer_accounts_service_1 = require("./customer-accounts.service");
const name_memory_service_1 = require("./name-memory.service");
const reports_service_1 = require("./reports.service");
const splits_service_1 = require("./splits.service");
const statement_extractor_1 = require("./statement-extractor");
const statement_processor_service_1 = require("./statement-processor.service");
const tax_service_1 = require("./tax.service");
let BookkeepingModule = class BookkeepingModule {
};
exports.BookkeepingModule = BookkeepingModule;
exports.BookkeepingModule = BookkeepingModule = __decorate([
    (0, common_1.Module)({
        imports: [customer_auth_module_1.CustomerAuthModule],
        controllers: [bookkeeping_controller_1.BookkeepingController],
        providers: [
            attachment_extractor_1.AttachmentExtractor,
            attachment_processor_service_1.AttachmentProcessorService,
            attachments_service_1.AttachmentsService,
            bookkeeping_service_1.BookkeepingService,
            customer_accounts_service_1.CustomerAccountsService,
            export_service_1.LedgerExportService,
            name_memory_service_1.NameMemoryService,
            openai_client_1.OpenAiClient,
            reports_service_1.ReportsService,
            splits_service_1.SplitsService,
            statement_extractor_1.StatementExtractor,
            statement_processor_service_1.StatementProcessorService,
            tax_service_1.TaxService,
        ],
        exports: [bookkeeping_service_1.BookkeepingService],
    })
], BookkeepingModule);
//# sourceMappingURL=bookkeeping.module.js.map