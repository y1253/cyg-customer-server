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
var PlaidWebhookController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaidWebhookController = exports.BankFeedsController = void 0;
const common_1 = require("@nestjs/common");
const book_scope_guard_1 = require("../bookkeeping/book-scope.guard");
const customer_jwt_guard_1 = require("../customer-auth/customer-jwt.guard");
const bank_feeds_service_1 = require("./bank-feeds.service");
const bank_feeds_dto_1 = require("./dto/bank-feeds.dto");
let BankFeedsController = class BankFeedsController {
    feeds;
    constructor(feeds) {
        this.feeds = feeds;
    }
    config() {
        return { enabled: this.feeds.enabled };
    }
    list(scope) {
        return this.feeds.list(scope);
    }
    linkToken(scope, itemId, accounts) {
        if (itemId !== undefined && !/^[1-9]\d{0,9}$/.test(itemId)) {
            throw new common_1.BadRequestException('Invalid connection');
        }
        return this.feeds.linkToken(scope, itemId ? Number(itemId) : undefined, accounts === '1');
    }
    exchange(scope, dto) {
        return this.feeds.exchange(scope, dto.publicToken);
    }
    reconnected(scope, id) {
        return this.feeds.reconnected(scope, id);
    }
    setStartDates(scope, id, dto) {
        return this.feeds.setStartDates(scope, id, dto.accounts);
    }
    refresh(scope, id) {
        return this.feeds.refresh(scope, id);
    }
    async remove(scope, id) {
        await this.feeds.remove(scope, id);
    }
};
exports.BankFeedsController = BankFeedsController;
__decorate([
    (0, common_1.Get)('config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], BankFeedsController.prototype, "config", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BankFeedsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('link-token'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Query)('itemId')),
    __param(2, (0, common_1.Query)('accounts')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], BankFeedsController.prototype, "linkToken", null);
__decorate([
    (0, common_1.Post)('exchange'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, bank_feeds_dto_1.ExchangeDto]),
    __metadata("design:returntype", Promise)
], BankFeedsController.prototype, "exchange", null);
__decorate([
    (0, common_1.Post)(':id/reconnected'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BankFeedsController.prototype, "reconnected", null);
__decorate([
    (0, common_1.Put)(':id/accounts'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, bank_feeds_dto_1.StartDatesDto]),
    __metadata("design:returntype", Promise)
], BankFeedsController.prototype, "setStartDates", null);
__decorate([
    (0, common_1.Post)(':id/sync'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BankFeedsController.prototype, "refresh", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BankFeedsController.prototype, "remove", null);
exports.BankFeedsController = BankFeedsController = __decorate([
    (0, common_1.Controller)('bank-feeds'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard, book_scope_guard_1.BookScopeGuard),
    __metadata("design:paramtypes", [bank_feeds_service_1.BankFeedsService])
], BankFeedsController);
let PlaidWebhookController = PlaidWebhookController_1 = class PlaidWebhookController {
    feeds;
    logger = new common_1.Logger(PlaidWebhookController_1.name);
    constructor(feeds) {
        this.feeds = feeds;
    }
    async webhook(req, token) {
        if (!this.feeds.enabled)
            throw new common_1.NotFoundException();
        const problem = await this.feeds.verify(token, req.rawBody);
        if (problem) {
            this.logger.warn(`rejected a Plaid webhook: ${problem}`);
            throw new common_1.BadRequestException('Invalid signature');
        }
        let body;
        try {
            body = JSON.parse(req.rawBody.toString('utf8'));
        }
        catch {
            throw new common_1.BadRequestException('Invalid body');
        }
        void this.feeds
            .handle(body)
            .catch((err) => this.logger.warn(`Plaid webhook handling failed: ${String(err)}`));
        return { received: true };
    }
};
exports.PlaidWebhookController = PlaidWebhookController;
__decorate([
    (0, common_1.Post)('webhook'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Headers)('plaid-verification')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PlaidWebhookController.prototype, "webhook", null);
exports.PlaidWebhookController = PlaidWebhookController = PlaidWebhookController_1 = __decorate([
    (0, common_1.Controller)('plaid'),
    __metadata("design:paramtypes", [bank_feeds_service_1.BankFeedsService])
], PlaidWebhookController);
//# sourceMappingURL=bank-feeds.controller.js.map