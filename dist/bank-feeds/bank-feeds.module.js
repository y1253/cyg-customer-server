"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BankFeedsModule = void 0;
const common_1 = require("@nestjs/common");
const openai_client_1 = require("../ai/openai.client");
const bookkeeping_module_1 = require("../bookkeeping/bookkeeping.module");
const customer_auth_module_1 = require("../customer-auth/customer-auth.module");
const bank_feed_sync_service_1 = require("./bank-feed-sync.service");
const bank_feeds_controller_1 = require("./bank-feeds.controller");
const bank_feeds_service_1 = require("./bank-feeds.service");
const bank_row_categorizer_1 = require("./bank-row-categorizer");
const plaid_client_1 = require("./plaid.client");
let BankFeedsModule = class BankFeedsModule {
};
exports.BankFeedsModule = BankFeedsModule;
exports.BankFeedsModule = BankFeedsModule = __decorate([
    (0, common_1.Module)({
        imports: [customer_auth_module_1.CustomerAuthModule, bookkeeping_module_1.BookkeepingModule],
        controllers: [bank_feeds_controller_1.BankFeedsController, bank_feeds_controller_1.PlaidWebhookController],
        providers: [
            bank_feed_sync_service_1.BankFeedSyncService,
            bank_feeds_service_1.BankFeedsService,
            bank_row_categorizer_1.BankRowCategorizer,
            openai_client_1.OpenAiClient,
            plaid_client_1.PlaidClient,
        ],
    })
], BankFeedsModule);
//# sourceMappingURL=bank-feeds.module.js.map