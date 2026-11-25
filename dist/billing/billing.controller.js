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
const no_subscription_needed_decorator_1 = require("../customer-auth/no-subscription-needed.decorator");
const billing_dto_1 = require("./dto/billing.dto");
const stripe_billing_service_1 = require("./stripe-billing.service");
let BillingController = class BillingController {
    billing;
    constructor(billing) {
        this.billing = billing;
    }
    async config() {
        return { price: await this.billing.price() };
    }
    subscription(req) {
        return this.billing.view(req.user.customerId);
    }
    subscribe(req) {
        return this.billing.startCheckout(req.user.customerId);
    }
    portal(req) {
        return this.billing.portal(req.user.customerId);
    }
    redeem(req, dto) {
        return this.billing.redeemPromo(req.user.customerId, dto.promoCode);
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
    (0, common_1.Get)('subscription'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "subscription", null);
__decorate([
    (0, common_1.Post)('subscribe'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "subscribe", null);
__decorate([
    (0, common_1.Post)('portal'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "portal", null);
__decorate([
    (0, common_1.Post)('redeem'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, billing_dto_1.RedeemDto]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "redeem", null);
exports.BillingController = BillingController = __decorate([
    (0, common_1.Controller)('billing'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard),
    (0, no_subscription_needed_decorator_1.NoSubscriptionNeeded)(),
    __metadata("design:paramtypes", [stripe_billing_service_1.StripeBillingService])
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
    __metadata("design:paramtypes", [stripe_billing_service_1.StripeBillingService])
], BillingWebhookController);
//# sourceMappingURL=billing.controller.js.map