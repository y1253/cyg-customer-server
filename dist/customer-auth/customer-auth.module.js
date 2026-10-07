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
const customer_auth_controller_1 = require("./customer-auth.controller");
const customer_auth_service_1 = require("./customer-auth.service");
const customer_jwt_guard_1 = require("./customer-jwt.guard");
const customer_jwt_strategy_1 = require("./customer-jwt.strategy");
let CustomerAuthModule = class CustomerAuthModule {
};
exports.CustomerAuthModule = CustomerAuthModule;
exports.CustomerAuthModule = CustomerAuthModule = __decorate([
    (0, common_1.Module)({
        imports: [
            passport_1.PassportModule,
            jwt_1.JwtModule.registerAsync({
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    secret: config.getOrThrow('CUSTOMER_JWT_SECRET'),
                    signOptions: { expiresIn: '7d' },
                }),
            }),
        ],
        controllers: [customer_auth_controller_1.CustomerAuthController],
        providers: [customer_auth_service_1.CustomerAuthService, customer_jwt_strategy_1.CustomerJwtStrategy, customer_jwt_guard_1.CustomerJwtGuard],
        exports: [customer_jwt_guard_1.CustomerJwtGuard],
    })
], CustomerAuthModule);
//# sourceMappingURL=customer-auth.module.js.map