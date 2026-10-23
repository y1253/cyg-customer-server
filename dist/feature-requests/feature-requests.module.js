"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeatureRequestsModule = void 0;
const common_1 = require("@nestjs/common");
const customer_auth_module_1 = require("../customer-auth/customer-auth.module");
const messaging_module_1 = require("../messaging/messaging.module");
const schedules_module_1 = require("../schedules/schedules.module");
const feature_requests_controller_1 = require("./feature-requests.controller");
const feature_requests_service_1 = require("./feature-requests.service");
let FeatureRequestsModule = class FeatureRequestsModule {
};
exports.FeatureRequestsModule = FeatureRequestsModule;
exports.FeatureRequestsModule = FeatureRequestsModule = __decorate([
    (0, common_1.Module)({
        imports: [customer_auth_module_1.CustomerAuthModule, messaging_module_1.MessagingModule, schedules_module_1.SchedulesModule],
        controllers: [feature_requests_controller_1.FeatureRequestsController],
        providers: [feature_requests_service_1.FeatureRequestsService],
    })
], FeatureRequestsModule);
//# sourceMappingURL=feature-requests.module.js.map