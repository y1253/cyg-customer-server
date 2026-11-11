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
exports.CustomColumnOrderDto = exports.CustomAnswerDto = exports.CopyCustomColumnsDto = exports.CustomColumnDto = exports.CustomColumnOptionDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
class CustomColumnOptionDto {
    id;
    label;
}
exports.CustomColumnOptionDto = CustomColumnOptionDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CustomColumnOptionDto.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CustomColumnOptionDto.prototype, "label", void 0);
class CustomColumnDto {
    name;
    type;
    minChars;
    maxChars;
    required;
    options;
}
exports.CustomColumnDto = CustomColumnDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CustomColumnDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CustomColumnDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Object)
], CustomColumnDto.prototype, "minChars", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    __metadata("design:type", Object)
], CustomColumnDto.prototype, "maxChars", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CustomColumnDto.prototype, "required", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(200),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => CustomColumnOptionDto),
    __metadata("design:type", Array)
], CustomColumnDto.prototype, "options", void 0);
class CopyCustomColumnsDto {
    fromBookId;
}
exports.CopyCustomColumnsDto = CopyCustomColumnsDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CopyCustomColumnsDto.prototype, "fromBookId", void 0);
class CustomAnswerDto {
    value;
    dropDownId;
}
exports.CustomAnswerDto = CustomAnswerDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", Object)
], CustomAnswerDto.prototype, "value", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Object)
], CustomAnswerDto.prototype, "dropDownId", void 0);
class CustomColumnOrderDto {
    ids;
}
exports.CustomColumnOrderDto = CustomColumnOrderDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(100),
    (0, class_validator_1.IsInt)({ each: true }),
    __metadata("design:type", Array)
], CustomColumnOrderDto.prototype, "ids", void 0);
//# sourceMappingURL=custom-column.dto.js.map