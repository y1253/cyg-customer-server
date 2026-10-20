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
exports.IntakeCustomer = exports.IntakeAgentGuard = exports.INTAKE_AGENT_TOKEN_TYPE = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const prisma_service_1 = require("../prisma/prisma.service");
exports.INTAKE_AGENT_TOKEN_TYPE = 'intake-agent';
let IntakeAgentGuard = class IntakeAgentGuard {
    prisma;
    jwt;
    constructor(config, prisma) {
        this.prisma = prisma;
        this.jwt = new jwt_1.JwtService({
            secret: config.getOrThrow('CUSTOMER_JWT_SECRET'),
        });
    }
    async canActivate(ctx) {
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
        if (p.typ !== exports.INTAKE_AGENT_TOKEN_TYPE || typeof p.sub !== 'number') {
            throw new common_1.UnauthorizedException();
        }
        const customer = await this.prisma.customer.findFirst({
            where: { id: p.sub, deletedAt: null },
            select: { id: true },
        });
        if (!customer)
            throw new common_1.UnauthorizedException();
        req.intakeCustomerId = customer.id;
        return true;
    }
};
exports.IntakeAgentGuard = IntakeAgentGuard;
exports.IntakeAgentGuard = IntakeAgentGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], IntakeAgentGuard);
exports.IntakeCustomer = (0, common_1.createParamDecorator)((_, ctx) => {
    const id = ctx.switchToHttp().getRequest().intakeCustomerId;
    if (!id)
        throw new Error('IntakeAgentGuard did not run on this route');
    return id;
});
//# sourceMappingURL=intake-agent.guard.js.map