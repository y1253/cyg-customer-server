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
exports.StartDatesDto = exports.StartDateDto = exports.ExchangeDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
class ExchangeDto {
    publicToken;
}
exports.ExchangeDto = ExchangeDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    (0, class_validator_1.Matches)(/^public-[a-z]+-[A-Za-z0-9-]+$/, {
        message: 'Invalid bank connection token',
    }),
    __metadata("design:type", String)
], ExchangeDto.prototype, "publicToken", void 0);
class StartDateDto {
    id;
    startDate;
}
exports.StartDateDto = StartDateDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], StartDateDto.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsISO8601)({ strict: true }),
    (0, class_validator_1.Matches)(/^\d{4}-\d{2}-\d{2}$/, { message: 'A start date is YYYY-MM-DD' }),
    __metadata("design:type", Object)
], StartDateDto.prototype, "startDate", void 0);
class StartDatesDto {
    accounts;
}
exports.StartDatesDto = StartDatesDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1),
    (0, class_validator_1.ArrayMaxSize)(100),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => StartDateDto),
    __metadata("design:type", Array)
], StartDatesDto.prototype, "accounts", void 0);
//# sourceMappingURL=bank-feeds.dto.js.map