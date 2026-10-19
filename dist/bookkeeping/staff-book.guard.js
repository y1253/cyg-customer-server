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
exports.Staff = exports.StaffBookGuard = exports.STAFF_BOOK_TOKEN_TYPE = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const prisma_service_1 = require("../prisma/prisma.service");
exports.STAFF_BOOK_TOKEN_TYPE = 'staff-book';
let StaffBookGuard = class StaffBookGuard {
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
        const payload = this.verify(req.headers.authorization);
        const companyId = Number(req.params?.companyId);
        if (payload.companyId !== companyId)
            throw new common_1.UnauthorizedException();
        if (req.method !== 'GET' && !payload.canEdit) {
            throw new common_1.ForbiddenException('Only a manager can change these rules');
        }
        req.staffBook = {
            scope: await this.scopeOf(companyId),
            staffUserId: payload.sub,
            canEdit: payload.canEdit,
        };
        return true;
    }
    verify(header) {
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
        if (p.typ !== exports.STAFF_BOOK_TOKEN_TYPE ||
            typeof p.sub !== 'number' ||
            typeof p.companyId !== 'number') {
            throw new common_1.UnauthorizedException();
        }
        return { ...p, canEdit: p.canEdit === true };
    }
    async scopeOf(companyId) {
        const company = await this.prisma.company.findFirst({
            where: {
                id: companyId,
                customerId: { not: null },
                isDraft: false,
                isInternal: false,
                deletedAt: null,
            },
            select: { customerId: true },
        });
        if (!company?.customerId)
            throw new common_1.NotFoundException('Business not found');
        return { customerId: company.customerId, companyId };
    }
};
exports.StaffBookGuard = StaffBookGuard;
exports.StaffBookGuard = StaffBookGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], StaffBookGuard);
exports.Staff = (0, common_1.createParamDecorator)((_, ctx) => {
    const staff = ctx.switchToHttp().getRequest().staffBook;
    if (!staff)
        throw new Error('StaffBookGuard did not run on this route');
    return staff;
});
//# sourceMappingURL=staff-book.guard.js.map