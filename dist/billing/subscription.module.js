"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionModule = void 0;
const common_1 = require("@nestjs/common");
const messaging_module_1 = require("../messaging/messaging.module");
const stripe_billing_service_1 = require("./stripe-billing.service");
const stripe_client_1 = require("./stripe.client");
const subscription_service_1 = require("./subscription.service");
let SubscriptionModule = class SubscriptionModule {
};
exports.SubscriptionModule = SubscriptionModule;
exports.SubscriptionModule = SubscriptionModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [messaging_module_1.MessagingModule],
        providers: [stripe_client_1.StripeClient, subscription_service_1.SubscriptionService, stripe_billing_service_1.StripeBillingService],
        exports: [stripe_client_1.StripeClient, subscription_service_1.SubscriptionService, stripe_billing_service_1.StripeBillingService],
    })
], SubscriptionModule);
//# sourceMappingURL=subscription.module.js.map