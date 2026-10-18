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
exports.CustomerAuthController = void 0;
const common_1 = require("@nestjs/common");
const customer_auth_service_1 = require("./customer-auth.service");
const customer_jwt_guard_1 = require("./customer-jwt.guard");
const change_password_dto_1 = require("./dto/change-password.dto");
const forgot_password_dto_1 = require("./dto/forgot-password.dto");
const google_login_dto_1 = require("./dto/google-login.dto");
const login_dto_1 = require("./dto/login.dto");
const resend_signup_dto_1 = require("./dto/resend-signup.dto");
const reset_password_dto_1 = require("./dto/reset-password.dto");
const signup_dto_1 = require("./dto/signup.dto");
const update_me_dto_1 = require("./dto/update-me.dto");
const verify_signup_dto_1 = require("./dto/verify-signup.dto");
let CustomerAuthController = class CustomerAuthController {
    auth;
    constructor(auth) {
        this.auth = auth;
    }
    config() {
        return {
            googleClientId: this.auth.googleClientId(),
            turnstileSiteKey: this.auth.turnstileSiteKey(),
        };
    }
    async signup(dto, req) {
        const ip = req.ip ?? 'unknown';
        await this.auth.verifyHuman(dto.turnstileToken, ip);
        return this.auth.signup(dto, ip);
    }
    verifySignup(dto, req) {
        return this.auth.verifySignup(dto, req.ip ?? 'unknown');
    }
    resendSignup(dto, req) {
        return this.auth.resendSignupCode(dto, req.ip ?? 'unknown');
    }
    login(dto, req) {
        return this.auth.login(dto, req.ip ?? 'unknown');
    }
    google(dto) {
        return this.auth.google(dto);
    }
    async forgotPassword(dto, req) {
        const ip = req.ip ?? 'unknown';
        await this.auth.verifyHuman(dto.turnstileToken, ip);
        return this.auth.forgotPassword(dto, ip);
    }
    resetPassword(dto, req) {
        return this.auth.resetPassword(dto, req.ip ?? 'unknown');
    }
    me(req) {
        return this.auth.me(req.user.customerId);
    }
    updateMe(req, dto) {
        return this.auth.updateMe(req.user.customerId, dto);
    }
    changePassword(req, dto) {
        return this.auth.changePassword(req.user.customerId, dto, req.ip ?? 'unknown');
    }
    sendPasswordCode(req) {
        return this.auth.sendPasswordCode(req.user.customerId, req.ip ?? 'unknown');
    }
};
exports.CustomerAuthController = CustomerAuthController;
__decorate([
    (0, common_1.Get)('config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], CustomerAuthController.prototype, "config", null);
__decorate([
    (0, common_1.Post)('signup'),
    (0, common_1.HttpCode)(202),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [signup_dto_1.SignupDto, Object]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "signup", null);
__decorate([
    (0, common_1.Post)('signup/verify'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [verify_signup_dto_1.VerifySignupDto, Object]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "verifySignup", null);
__decorate([
    (0, common_1.Post)('signup/resend'),
    (0, common_1.HttpCode)(202),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [resend_signup_dto_1.ResendSignupDto, Object]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "resendSignup", null);
__decorate([
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto, Object]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('google'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [google_login_dto_1.GoogleLoginDto]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "google", null);
__decorate([
    (0, common_1.Post)('password/forgot'),
    (0, common_1.HttpCode)(202),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [forgot_password_dto_1.ForgotPasswordDto, Object]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "forgotPassword", null);
__decorate([
    (0, common_1.Post)('password/reset'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [reset_password_dto_1.ResetPasswordDto, Object]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "resetPassword", null);
__decorate([
    (0, common_1.Get)('me'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "me", null);
__decorate([
    (0, common_1.Patch)('me'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, update_me_dto_1.UpdateMeDto]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "updateMe", null);
__decorate([
    (0, common_1.Post)('me/password'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, change_password_dto_1.ChangePasswordDto]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "changePassword", null);
__decorate([
    (0, common_1.Post)('me/password/code'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard),
    (0, common_1.HttpCode)(202),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CustomerAuthController.prototype, "sendPasswordCode", null);
exports.CustomerAuthController = CustomerAuthController = __decorate([
    (0, common_1.Controller)('customer-auth'),
    __metadata("design:paramtypes", [customer_auth_service_1.CustomerAuthService])
], CustomerAuthController);
//# sourceMappingURL=customer-auth.controller.js.map