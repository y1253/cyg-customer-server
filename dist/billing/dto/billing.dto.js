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
exports.CompleteDto = exports.CheckoutDto = exports.QuoteDto = void 0;
const class_validator_1 = require("class-validator");
class QuoteDto {
    promoCode;
}
exports.QuoteDto = QuoteDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], QuoteDto.prototype, "promoCode", void 0);
class CheckoutDto extends QuoteDto {
    paymentMethodId;
}
exports.CheckoutDto = CheckoutDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^pm_[A-Za-z0-9]+$/, { message: 'Invalid card' }),
    __metadata("design:type", String)
], CheckoutDto.prototype, "paymentMethodId", void 0);
class CompleteDto {
    paymentIntentId;
}
exports.CompleteDto = CompleteDto;
__decorate([
    (0, class_validator_1.Matches)(/^pi_[A-Za-z0-9]+$/, { message: 'Invalid payment' }),
    __metadata("design:type", String)
], CompleteDto.prototype, "paymentIntentId", void 0);
//# sourceMappingURL=billing.dto.js.map