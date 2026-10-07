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
const bookkeeping_controller_1 = require("./bookkeeping.controller");
const bookkeeping_service_1 = require("./bookkeeping.service");
const export_service_1 = require("./export.service");
const statement_extractor_1 = require("./statement-extractor");
const statement_processor_service_1 = require("./statement-processor.service");
let BookkeepingModule = class BookkeepingModule {
};
exports.BookkeepingModule = BookkeepingModule;
exports.BookkeepingModule = BookkeepingModule = __decorate([
    (0, common_1.Module)({
        imports: [customer_auth_module_1.CustomerAuthModule],
        controllers: [bookkeeping_controller_1.BookkeepingController],
        providers: [
            bookkeeping_service_1.BookkeepingService,
            export_service_1.LedgerExportService,
            openai_client_1.OpenAiClient,
            statement_extractor_1.StatementExtractor,
            statement_processor_service_1.StatementProcessorService,
        ],
    })
], BookkeepingModule);
//# sourceMappingURL=bookkeeping.module.js.map