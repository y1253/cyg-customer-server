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
exports.PhoneSignupDto = exports.PhoneLoginVerifyDto = exports.PhoneLoginDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const trim = ({ value }) => typeof value === 'string' ? value.trim() : value;
class PhoneLoginDto {
    phone;
    turnstileToken;
}
exports.PhoneLoginDto = PhoneLoginDto;
__decorate([
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Enter your phone number' }),
    (0, class_validator_1.MaxLength)(32),
    __metadata("design:type", String)
], PhoneLoginDto.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(4096),
    __metadata("design:type", String)
], PhoneLoginDto.prototype, "turnstileToken", void 0);
class PhoneLoginVerifyDto {
    phone;
    code;
}
exports.PhoneLoginVerifyDto = PhoneLoginVerifyDto;
__decorate([
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Enter your phone number' }),
    (0, class_validator_1.MaxLength)(32),
    __metadata("design:type", String)
], PhoneLoginVerifyDto.prototype, "phone", void 0);
__decorate([
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.Matches)(/^\d{6}$/, { message: 'Enter the 6-digit code' }),
    __metadata("design:type", String)
], PhoneLoginVerifyDto.prototype, "code", void 0);
class PhoneSignupDto {
    phone;
    createdWith;
}
exports.PhoneSignupDto = PhoneSignupDto;
__decorate([
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(32),
    __metadata("design:type", String)
], PhoneSignupDto.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['SMS', 'WHATSAPP', 'CALL']),
    __metadata("design:type", String)
], PhoneSignupDto.prototype, "createdWith", void 0);
//# sourceMappingURL=phone-login.dto.js.map