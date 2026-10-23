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
exports.Book = exports.BookScopeGuard = void 0;
exports.parseIdParam = parseIdParam;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const books_1 = require("./books");
function parseIdParam(raw, name = 'id') {
    if (raw === undefined || raw === null || raw === '')
        return null;
    if (typeof raw !== 'string' || !/^[1-9]\d{0,9}$/.test(raw)) {
        throw new common_1.BadRequestException(`${name} must be an id`);
    }
    return Number(raw);
}
let BookScopeGuard = class BookScopeGuard {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async canActivate(ctx) {
        const req = ctx.switchToHttp().getRequest();
        const customerId = req.user?.customerId;
        if (!customerId)
            return false;
        req.bookScope = await this.resolve(customerId, req.query ?? {});
        return true;
    }
    async resolve(customerId, query) {
        const bookId = parseIdParam(query.bookId, 'bookId');
        if (bookId !== null)
            return (0, books_1.ownBook)(this.prisma, customerId, bookId);
        const companyId = parseIdParam(query.companyId, 'companyId');
        if (companyId !== null)
            return (0, books_1.businessBook)(this.prisma, customerId, companyId);
        return (0, books_1.ensureDefaultBook)(this.prisma, customerId);
    }
};
exports.BookScopeGuard = BookScopeGuard;
exports.BookScopeGuard = BookScopeGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], BookScopeGuard);
exports.Book = (0, common_1.createParamDecorator)((_, ctx) => {
    const scope = ctx.switchToHttp().getRequest().bookScope;
    if (!scope)
        throw new Error('BookScopeGuard did not run on this route');
    return scope;
});
//# sourceMappingURL=book-scope.guard.js.map