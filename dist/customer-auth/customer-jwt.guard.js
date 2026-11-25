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
exports.CustomerJwtGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const passport_1 = require("@nestjs/passport");
const subscription_service_1 = require("../billing/subscription.service");
const no_subscription_needed_decorator_1 = require("./no-subscription-needed.decorator");
let CustomerJwtGuard = class CustomerJwtGuard extends (0, passport_1.AuthGuard)('customer-jwt') {
    reflector;
    subscriptions;
    constructor(reflector, subscriptions) {
        super();
        this.reflector = reflector;
        this.subscriptions = subscriptions;
    }
    async canActivate(context) {
        const ok = (await super.canActivate(context));
        if (!ok || !this.subscriptions)
            return ok;
        const open = this.reflector.getAllAndOverride(no_subscription_needed_decorator_1.NO_SUBSCRIPTION_NEEDED, [context.getHandler(), context.getClass()]);
        if (open)
            return true;
        const user = context
            .switchToHttp()
            .getRequest().user;
        if (user)
            await this.subscriptions.assertActive(user.customerId);
        return true;
    }
};
exports.CustomerJwtGuard = CustomerJwtGuard;
exports.CustomerJwtGuard = CustomerJwtGuard = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [core_1.Reflector,
        subscription_service_1.SubscriptionService])
], CustomerJwtGuard);
//# sourceMappingURL=customer-jwt.guard.js.map