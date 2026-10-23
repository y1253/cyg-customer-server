"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerAuthModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const passport_1 = require("@nestjs/passport");
const messaging_module_1 = require("../messaging/messaging.module");
const customer_auth_controller_1 = require("./customer-auth.controller");
const customer_auth_service_1 = require("./customer-auth.service");
const customer_jwt_guard_1 = require("./customer-jwt.guard");
const customer_jwt_strategy_1 = require("./customer-jwt.strategy");
const intake_system_guard_1 = require("./intake-system.guard");
const phone_auth_controller_1 = require("./phone-auth.controller");
const phone_auth_service_1 = require("./phone-auth.service");
let CustomerAuthModule = class CustomerAuthModule {
};
exports.CustomerAuthModule = CustomerAuthModule;
exports.CustomerAuthModule = CustomerAuthModule = __decorate([
    (0, common_1.Module)({
        imports: [
            passport_1.PassportModule,
            messaging_module_1.MessagingModule,
            jwt_1.JwtModule.registerAsync({
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    secret: config.getOrThrow('CUSTOMER_JWT_SECRET'),
                    signOptions: { expiresIn: '7d' },
                }),
            }),
        ],
        controllers: [
            customer_auth_controller_1.CustomerAuthController,
            phone_auth_controller_1.PhoneLoginController,
            phone_auth_controller_1.IntakeSignupController,
        ],
        providers: [
            customer_auth_service_1.CustomerAuthService,
            customer_jwt_strategy_1.CustomerJwtStrategy,
            customer_jwt_guard_1.CustomerJwtGuard,
            phone_auth_service_1.PhoneAuthService,
            intake_system_guard_1.IntakeSystemGuard,
        ],
        exports: [customer_jwt_guard_1.CustomerJwtGuard, customer_auth_service_1.CustomerAuthService, intake_system_guard_1.IntakeSystemGuard],
    })
], CustomerAuthModule);
//# sourceMappingURL=customer-auth.module.js.map