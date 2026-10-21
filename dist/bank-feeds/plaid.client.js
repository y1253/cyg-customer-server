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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaidClient = exports.PlaidApiError = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const HOSTS = {
    sandbox: 'https://sandbox.plaid.com',
    production: 'https://production.plaid.com',
};
const text = (v) => (typeof v === 'string' ? v : null);
class PlaidApiError extends Error {
    status;
    type;
    code;
    displayMessage;
    constructor(status, type, code, message, displayMessage) {
        super(message);
        this.status = status;
        this.type = type;
        this.code = code;
        this.displayMessage = displayMessage;
    }
}
exports.PlaidApiError = PlaidApiError;
let PlaidClient = class PlaidClient {
    config;
    constructor(config) {
        this.config = config;
    }
    get(name) {
        return this.config.get(name)?.trim() ?? '';
    }
    get configured() {
        return Boolean(this.get('PLAID_CLIENT_ID') && this.get('PLAID_SECRET'));
    }
    get env() {
        return this.get('PLAID_ENV') || 'sandbox';
    }
    get webhookUrl() {
        return this.get('PLAID_WEBHOOK_URL') || null;
    }
    get redirectUri() {
        return this.get('PLAID_REDIRECT_URI') || null;
    }
    get countryCodes() {
        const raw = this.get('PLAID_COUNTRY_CODES') || 'CA,US';
        return raw
            .split(',')
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean);
    }
    async call(path, body) {
        if (!this.configured) {
            throw new common_1.ServiceUnavailableException('Bank connections are not set up yet — please contact us.');
        }
        const host = HOSTS[this.env];
        if (!host)
            throw new Error(`PLAID_ENV must be sandbox or production, not "${this.env}"`);
        const res = await fetch(`${host}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: this.get('PLAID_CLIENT_ID'),
                secret: this.get('PLAID_SECRET'),
                ...body,
            }),
            signal: AbortSignal.timeout(60_000),
        });
        const json = (await res.json().catch(() => ({})));
        if (!res.ok) {
            throw new PlaidApiError(res.status, text(json.error_type) ?? 'API_ERROR', text(json.error_code) ?? `HTTP_${res.status}`, text(json.error_message) ?? `Plaid ${path} answered ${res.status}`, typeof json.display_message === 'string' ? json.display_message : null);
        }
        return json;
    }
};
exports.PlaidClient = PlaidClient;
exports.PlaidClient = PlaidClient = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], PlaidClient);
//# sourceMappingURL=plaid.client.js.map