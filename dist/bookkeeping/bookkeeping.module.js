"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookkeepingModule = void 0;
const file_links_1 = require("./file-links");
const common_1 = require("@nestjs/common");
const openai_client_1 = require("../ai/openai.client");
const instructions_service_1 = require("../assistant/instructions.service");
const rules_service_1 = require("../assistant/rules.service");
const customer_auth_module_1 = require("../customer-auth/customer-auth.module");
const attachment_extractor_1 = require("./attachment-extractor");
const attachment_processor_service_1 = require("./attachment-processor.service");
const attachments_service_1 = require("./attachments.service");
const book_scope_guard_1 = require("./book-scope.guard");
const bookkeeping_controller_1 = require("./bookkeeping.controller");
const bookkeeping_service_1 = require("./bookkeeping.service");
const export_service_1 = require("./export.service");
const fx_service_1 = require("./fx.service");
const customer_accounts_service_1 = require("./customer-accounts.service");
const name_memory_service_1 = require("./name-memory.service");
const product_categorizer_1 = require("./product-categorizer");
const product_memory_service_1 = require("./product-memory.service");
const reports_service_1 = require("./reports.service");
const splits_service_1 = require("./splits.service");
const staff_book_guard_1 = require("./staff-book.guard");
const staff_rules_controller_1 = require("./staff-rules.controller");
const staff_rules_service_1 = require("./staff-rules.service");
const statement_extractor_1 = require("./statement-extractor");
const statement_images_service_1 = require("./statement-images.service");
const statement_processor_service_1 = require("./statement-processor.service");
const tax_service_1 = require("./tax.service");
const communications_service_1 = require("./communications.service");
let BookkeepingModule = class BookkeepingModule {
};
exports.BookkeepingModule = BookkeepingModule;
exports.BookkeepingModule = BookkeepingModule = __decorate([
    (0, common_1.Module)({
        imports: [customer_auth_module_1.CustomerAuthModule],
        controllers: [
            bookkeeping_controller_1.BookkeepingController,
            staff_rules_controller_1.StaffRulesController,
            file_links_1.FileLinkController,
        ],
        providers: [
            attachment_extractor_1.AttachmentExtractor,
            attachment_processor_service_1.AttachmentProcessorService,
            attachments_service_1.AttachmentsService,
            bookkeeping_service_1.BookkeepingService,
            book_scope_guard_1.BookScopeGuard,
            communications_service_1.CommunicationsService,
            customer_accounts_service_1.CustomerAccountsService,
            file_links_1.FileLinkService,
            fx_service_1.FxService,
            instructions_service_1.InstructionsService,
            export_service_1.LedgerExportService,
            name_memory_service_1.NameMemoryService,
            openai_client_1.OpenAiClient,
            product_categorizer_1.ProductCategorizer,
            product_memory_service_1.ProductMemoryService,
            reports_service_1.ReportsService,
            rules_service_1.RulesService,
            splits_service_1.SplitsService,
            staff_book_guard_1.StaffBookGuard,
            staff_rules_service_1.StaffRulesService,
            statement_extractor_1.StatementExtractor,
            statement_images_service_1.StatementImagesService,
            statement_processor_service_1.StatementProcessorService,
            tax_service_1.TaxService,
        ],
        exports: [
            attachment_processor_service_1.AttachmentProcessorService,
            attachments_service_1.AttachmentsService,
            bookkeeping_service_1.BookkeepingService,
            book_scope_guard_1.BookScopeGuard,
            customer_accounts_service_1.CustomerAccountsService,
            file_links_1.FileLinkService,
            instructions_service_1.InstructionsService,
            export_service_1.LedgerExportService,
            name_memory_service_1.NameMemoryService,
            reports_service_1.ReportsService,
            rules_service_1.RulesService,
            splits_service_1.SplitsService,
            tax_service_1.TaxService,
        ],
    })
], BookkeepingModule);
//# sourceMappingURL=bookkeeping.module.js.map