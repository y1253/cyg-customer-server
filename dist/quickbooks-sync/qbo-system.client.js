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
exports.QboSystemClient = exports.QboCallError = exports.QBO_SYSTEM_TOKEN_TYPE = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
exports.QBO_SYSTEM_TOKEN_TYPE = 'qbo-system';
class QboCallError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.QboCallError = QboCallError;
let QboSystemClient = class QboSystemClient {
    config;
    jwt;
    constructor(config) {
        this.config = config;
        this.jwt = new jwt_1.JwtService({
            secret: config.getOrThrow('CUSTOMER_JWT_SECRET'),
        });
    }
    query(companyId, query) {
        return this.post(companyId, 'query', { query });
    }
    create(companyId, entity, body) {
        return this.post(companyId, 'create', { entity, body });
    }
    update(companyId, entity, id, body) {
        return this.post(companyId, 'update', { entity, id, body });
    }
    remove(companyId, entity, id) {
        return this.post(companyId, 'remove', { entity, id });
    }
    async post(companyId, path, body) {
        const base = (this.config.get('INTERNAL_API_URL') ?? 'http://localhost:3000/api').replace(/\/+$/, '');
        const token = this.jwt.sign({ typ: exports.QBO_SYSTEM_TOKEN_TYPE, companyId }, { expiresIn: '60s' });
        let res;
        try {
            res = await fetch(`${base}/qbo-system/companies/${companyId}/${path}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(45_000),
            });
        }
        catch (err) {
            throw new QboCallError(0, `The internal API is unreachable: ${String(err)}`);
        }
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        }
        catch {
            json = text;
        }
        if (!res.ok) {
            const message = json?.message ?? `HTTP ${res.status}`;
            throw new QboCallError(res.status, Array.isArray(message) ? message.join('; ') : String(message));
        }
        return json;
    }
};
exports.QboSystemClient = QboSystemClient;
exports.QboSystemClient = QboSystemClient = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], QboSystemClient);
//# sourceMappingURL=qbo-system.client.js.map