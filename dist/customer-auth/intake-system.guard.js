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
exports.IntakeSystemGuard = exports.INTAKE_SYSTEM_TOKEN_TYPE = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
exports.INTAKE_SYSTEM_TOKEN_TYPE = 'intake-system';
let IntakeSystemGuard = class IntakeSystemGuard {
    jwt;
    constructor(config) {
        this.jwt = new jwt_1.JwtService({
            secret: config.getOrThrow('CUSTOMER_JWT_SECRET'),
        });
    }
    canActivate(ctx) {
        const req = ctx.switchToHttp().getRequest();
        const header = req.headers.authorization;
        const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
        if (!token)
            throw new common_1.UnauthorizedException();
        let p;
        try {
            p = this.jwt.verify(token);
        }
        catch {
            throw new common_1.UnauthorizedException();
        }
        if (p.typ !== exports.INTAKE_SYSTEM_TOKEN_TYPE)
            throw new common_1.UnauthorizedException();
        return true;
    }
};
exports.IntakeSystemGuard = IntakeSystemGuard;
exports.IntakeSystemGuard = IntakeSystemGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], IntakeSystemGuard);
//# sourceMappingURL=intake-system.guard.js.map