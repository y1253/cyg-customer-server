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
exports.StaffQboImportController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const qbo_import_service_1 = require("./qbo-import.service");
const staff_book_guard_1 = require("./staff-book.guard");
class AnalyzeImportDto {
    since;
    txns;
}
__decorate([
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], AnalyzeImportDto.prototype, "since", void 0);
__decorate([
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], AnalyzeImportDto.prototype, "txns", void 0);
class ApplyImportDto {
    plan;
}
__decorate([
    (0, class_validator_1.Allow)(),
    __metadata("design:type", Object)
], ApplyImportDto.prototype, "plan", void 0);
let StaffQboImportController = class StaffQboImportController {
    imports;
    constructor(imports) {
        this.imports = imports;
    }
    analyze(_companyId, staff, dto) {
        return this.imports.analyze(staff.scope, dto);
    }
    apply(_companyId, staff, dto) {
        return this.imports.apply(staff.scope, dto.plan);
    }
};
exports.StaffQboImportController = StaffQboImportController;
__decorate([
    (0, common_1.Post)('analyze'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, staff_book_guard_1.Staff)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, AnalyzeImportDto]),
    __metadata("design:returntype", Promise)
], StaffQboImportController.prototype, "analyze", null);
__decorate([
    (0, common_1.Post)('apply'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, staff_book_guard_1.Staff)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, ApplyImportDto]),
    __metadata("design:returntype", Promise)
], StaffQboImportController.prototype, "apply", null);
exports.StaffQboImportController = StaffQboImportController = __decorate([
    (0, common_1.Controller)('staff/books/:companyId/qbo-import'),
    (0, common_1.UseGuards)(staff_book_guard_1.StaffBookGuard),
    __metadata("design:paramtypes", [qbo_import_service_1.QboImportService])
], StaffQboImportController);
//# sourceMappingURL=staff-qbo-import.controller.js.map