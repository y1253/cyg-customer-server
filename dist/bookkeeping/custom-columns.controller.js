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
exports.CustomColumnsController = void 0;
const common_1 = require("@nestjs/common");
const customer_jwt_guard_1 = require("../customer-auth/customer-jwt.guard");
const book_scope_guard_1 = require("./book-scope.guard");
const custom_columns_service_1 = require("./custom-columns.service");
const custom_column_dto_1 = require("./dto/custom-column.dto");
let CustomColumnsController = class CustomColumnsController {
    columns;
    constructor(columns) {
        this.columns = columns;
    }
    view(scope) {
        return this.columns.view(scope);
    }
    async create(scope, dto) {
        await this.columns.create(scope, dto);
        return this.columns.view(scope);
    }
    async copy(scope, dto) {
        await this.columns.copy(scope, dto.fromBookId);
        return this.columns.view(scope);
    }
    async reorder(scope, dto) {
        await this.columns.reorder(scope, dto.ids);
        return this.columns.view(scope);
    }
    async update(scope, id, dto) {
        await this.columns.update(scope, id, dto);
        return this.columns.view(scope);
    }
    async remove(scope, id) {
        await this.columns.remove(scope, id);
        return this.columns.view(scope);
    }
    async answer(scope, id, columnId, dto) {
        await this.columns.answer(scope, [id], columnId, dto);
        return this.columns.view(scope);
    }
};
exports.CustomColumnsController = CustomColumnsController;
__decorate([
    (0, common_1.Get)('custom-columns'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CustomColumnsController.prototype, "view", null);
__decorate([
    (0, common_1.Post)('custom-columns'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, custom_column_dto_1.CustomColumnDto]),
    __metadata("design:returntype", Promise)
], CustomColumnsController.prototype, "create", null);
__decorate([
    (0, common_1.Post)('custom-columns/copy'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, custom_column_dto_1.CopyCustomColumnsDto]),
    __metadata("design:returntype", Promise)
], CustomColumnsController.prototype, "copy", null);
__decorate([
    (0, common_1.Put)('custom-columns/order'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, custom_column_dto_1.CustomColumnOrderDto]),
    __metadata("design:returntype", Promise)
], CustomColumnsController.prototype, "reorder", null);
__decorate([
    (0, common_1.Patch)('custom-columns/:id'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, custom_column_dto_1.CustomColumnDto]),
    __metadata("design:returntype", Promise)
], CustomColumnsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)('custom-columns/:id'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], CustomColumnsController.prototype, "remove", null);
__decorate([
    (0, common_1.Put)('transactions/:id/custom/:columnId'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)('columnId', common_1.ParseIntPipe)),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Number, custom_column_dto_1.CustomAnswerDto]),
    __metadata("design:returntype", Promise)
], CustomColumnsController.prototype, "answer", null);
exports.CustomColumnsController = CustomColumnsController = __decorate([
    (0, common_1.Controller)('bookkeeping'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard, book_scope_guard_1.BookScopeGuard),
    __metadata("design:paramtypes", [custom_columns_service_1.CustomColumnsService])
], CustomColumnsController);
//# sourceMappingURL=custom-columns.controller.js.map