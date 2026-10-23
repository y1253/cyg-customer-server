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
exports.BooksController = void 0;
const common_1 = require("@nestjs/common");
const customer_jwt_guard_1 = require("../customer-auth/customer-jwt.guard");
const prisma_service_1 = require("../prisma/prisma.service");
const books_1 = require("./books");
const book_dto_1 = require("./dto/book.dto");
let BooksController = class BooksController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    list(req) {
        return (0, books_1.listBooks)(this.prisma, req.user.customerId);
    }
    create(req, dto) {
        return (0, books_1.createBook)(this.prisma, req.user.customerId, dto.name);
    }
    rename(req, id, dto) {
        return (0, books_1.renameBook)(this.prisma, req.user.customerId, id, dto.name);
    }
};
exports.BooksController = BooksController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, book_dto_1.BookNameDto]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, book_dto_1.BookNameDto]),
    __metadata("design:returntype", Promise)
], BooksController.prototype, "rename", null);
exports.BooksController = BooksController = __decorate([
    (0, common_1.Controller)('bookkeeping/books'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], BooksController);
//# sourceMappingURL=books.controller.js.map