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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripeClient = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const stripe_1 = __importDefault(require("stripe"));
let StripeClient = class StripeClient {
    config;
    client = null;
    constructor(config) {
        this.config = config;
    }
    get configured() {
        return Boolean(this.config.get('STRIPE_SECRET_KEY')?.trim());
    }
    get publishableKey() {
        return this.config.get('STRIPE_PUBLISHABLE_KEY')?.trim() || null;
    }
    get webhookSecret() {
        return this.config.get('STRIPE_WEBHOOK_SECRET')?.trim() || null;
    }
    get stripe() {
        if (!this.client) {
            const key = this.config.get('STRIPE_SECRET_KEY')?.trim();
            if (!key)
                throw new common_1.ServiceUnavailableException('Payments are not set up yet — please contact us.');
            this.client = new stripe_1.default(key);
        }
        return this.client;
    }
};
exports.StripeClient = StripeClient;
exports.StripeClient = StripeClient = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], StripeClient);
//# sourceMappingURL=stripe.client.js.map