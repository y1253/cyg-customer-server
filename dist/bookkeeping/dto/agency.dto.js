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
exports.UpdateNameDto = exports.UpdateTaxDto = exports.UpdateAgencyDto = exports.CreateAgencyDto = exports.AgencyRateDto = void 0;
const client_1 = require("@prisma/client");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const trim = ({ value }) => typeof value === 'string' ? value.trim() : value;
class AgencyRateDto {
    kind;
    rate;
}
exports.AgencyRateDto = AgencyRateDto;
__decorate([
    (0, class_validator_1.IsEnum)(client_1.TaxKind),
    __metadata("design:type", String)
], AgencyRateDto.prototype, "kind", void 0);
__decorate([
    (0, class_validator_1.IsNumber)({ maxDecimalPlaces: 3 }, { message: 'Rate must be a number' }),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(100),
    __metadata("design:type", Number)
], AgencyRateDto.prototype, "rate", void 0);
class CreateAgencyDto {
    name;
    rates;
    active;
}
exports.CreateAgencyDto = CreateAgencyDto;
__decorate([
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Give the agency a name' }),
    (0, class_validator_1.MaxLength)(191),
    __metadata("design:type", String)
], CreateAgencyDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1, { message: 'Give the agency a Sales or a Purchase rate' }),
    (0, class_validator_1.ArrayMaxSize)(2),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => AgencyRateDto),
    __metadata("design:type", Array)
], CreateAgencyDto.prototype, "rates", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateAgencyDto.prototype, "active", void 0);
class UpdateAgencyDto {
    name;
    rates;
    active;
}
exports.UpdateAgencyDto = UpdateAgencyDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Give the agency a name' }),
    (0, class_validator_1.MaxLength)(191),
    __metadata("design:type", String)
], UpdateAgencyDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1, { message: 'Give the agency a Sales or a Purchase rate' }),
    (0, class_validator_1.ArrayMaxSize)(2),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => AgencyRateDto),
    __metadata("design:type", Array)
], UpdateAgencyDto.prototype, "rates", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateAgencyDto.prototype, "active", void 0);
class UpdateTaxDto {
    enabled;
}
exports.UpdateTaxDto = UpdateTaxDto;
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateTaxDto.prototype, "enabled", void 0);
class UpdateNameDto {
    name;
    taxExempt;
}
exports.UpdateNameDto = UpdateNameDto;
__decorate([
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(191),
    __metadata("design:type", String)
], UpdateNameDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateNameDto.prototype, "taxExempt", void 0);
//# sourceMappingURL=agency.dto.js.map