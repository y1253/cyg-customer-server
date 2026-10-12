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
exports.BillingWebhookController = exports.BillingController = void 0;
const common_1 = require("@nestjs/common");
const customer_jwt_guard_1 = require("../customer-auth/customer-jwt.guard");
const billing_service_1 = require("./billing.service");
const billing_dto_1 = require("./dto/billing.dto");
let BillingController = class BillingController {
    billing;
    constructor(billing) {
        this.billing = billing;
    }
    config() {
        return this.billing.config();
    }
    quote(dto) {
        return this.billing.quote(dto.promoCode);
    }
    cards(req) {
        return this.billing.cards(req.user.customerId);
    }
    async removeCard(req, id) {
        if (!/^pm_[A-Za-z0-9]+$/.test(id))
            throw new common_1.BadRequestException('Invalid card');
        await this.billing.removeCard(req.user.customerId, id);
    }
    checkout(req, dto) {
        return this.billing.checkout(req.user.customerId, dto.promoCode, dto.paymentMethodId);
    }
    complete(req, dto) {
        return this.billing.complete(req.user.customerId, dto.paymentIntentId);
    }
};
exports.BillingController = BillingController;
__decorate([
    (0, common_1.Get)('config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "config", null);
__decorate([
    (0, common_1.Post)('quote'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [billing_dto_1.QuoteDto]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "quote", null);
__decorate([
    (0, common_1.Get)('cards'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "cards", null);
__decorate([
    (0, common_1.Delete)('cards/:id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "removeCard", null);
__decorate([
    (0, common_1.Post)('checkout'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, billing_dto_1.CheckoutDto]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "checkout", null);
__decorate([
    (0, common_1.Post)('complete'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, billing_dto_1.CompleteDto]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "complete", null);
exports.BillingController = BillingController = __decorate([
    (0, common_1.Controller)('billing'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard),
    __metadata("design:paramtypes", [billing_service_1.BillingService])
], BillingController);
let BillingWebhookController = class BillingWebhookController {
    billing;
    constructor(billing) {
        this.billing = billing;
    }
    async webhook(req, signature) {
        if (!req.rawBody || !signature)
            throw new common_1.BadRequestException('Missing signature');
        await this.billing.handleWebhook(req.rawBody, signature);
        return { received: true };
    }
};
exports.BillingWebhookController = BillingWebhookController;
__decorate([
    (0, common_1.Post)('webhook'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Headers)('stripe-signature')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], BillingWebhookController.prototype, "webhook", null);
exports.BillingWebhookController = BillingWebhookController = __decorate([
    (0, common_1.Controller)('billing'),
    __metadata("design:paramtypes", [billing_service_1.BillingService])
], BillingWebhookController);
//# sourceMappingURL=billing.controller.js.map