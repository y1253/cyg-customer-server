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
exports.IntakeSignupController = exports.PhoneLoginController = void 0;
const common_1 = require("@nestjs/common");
const customer_auth_service_1 = require("./customer-auth.service");
const phone_login_dto_1 = require("./dto/phone-login.dto");
const intake_system_guard_1 = require("./intake-system.guard");
const phone_auth_service_1 = require("./phone-auth.service");
let PhoneLoginController = class PhoneLoginController {
    phone;
    auth;
    constructor(phone, auth) {
        this.phone = phone;
        this.auth = auth;
    }
    async request(dto, req) {
        const ip = req.ip ?? 'unknown';
        await this.auth.verifyHuman(dto.turnstileToken, ip);
        return this.phone.requestCode(dto.phone, ip);
    }
    verify(dto, req) {
        return this.phone.verifyCode(dto.phone, dto.code, req.ip ?? 'unknown');
    }
};
exports.PhoneLoginController = PhoneLoginController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(202),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [phone_login_dto_1.PhoneLoginDto, Object]),
    __metadata("design:returntype", Promise)
], PhoneLoginController.prototype, "request", null);
__decorate([
    (0, common_1.Post)('verify'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [phone_login_dto_1.PhoneLoginVerifyDto, Object]),
    __metadata("design:returntype", Promise)
], PhoneLoginController.prototype, "verify", null);
exports.PhoneLoginController = PhoneLoginController = __decorate([
    (0, common_1.Controller)('customer-auth/login/phone'),
    __metadata("design:paramtypes", [phone_auth_service_1.PhoneAuthService,
        customer_auth_service_1.CustomerAuthService])
], PhoneLoginController);
let IntakeSignupController = class IntakeSignupController {
    phone;
    constructor(phone) {
        this.phone = phone;
    }
    signup(dto) {
        return this.phone.signupByPhone(dto.phone, dto.createdWith);
    }
};
exports.IntakeSignupController = IntakeSignupController;
__decorate([
    (0, common_1.Post)('signup'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [phone_login_dto_1.PhoneSignupDto]),
    __metadata("design:returntype", Promise)
], IntakeSignupController.prototype, "signup", null);
exports.IntakeSignupController = IntakeSignupController = __decorate([
    (0, common_1.Controller)('intake-system'),
    (0, common_1.UseGuards)(intake_system_guard_1.IntakeSystemGuard),
    __metadata("design:paramtypes", [phone_auth_service_1.PhoneAuthService])
], IntakeSignupController);
//# sourceMappingURL=phone-auth.controller.js.map