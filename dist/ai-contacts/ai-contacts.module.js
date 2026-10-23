"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiContactsModule = void 0;
const common_1 = require("@nestjs/common");
const customer_auth_module_1 = require("../customer-auth/customer-auth.module");
const ai_contacts_controller_1 = require("./ai-contacts.controller");
const ai_contacts_service_1 = require("./ai-contacts.service");
let AiContactsModule = class AiContactsModule {
};
exports.AiContactsModule = AiContactsModule;
exports.AiContactsModule = AiContactsModule = __decorate([
    (0, common_1.Module)({
        imports: [customer_auth_module_1.CustomerAuthModule],
        controllers: [ai_contacts_controller_1.AiContactsController],
        providers: [ai_contacts_service_1.AiContactsService],
        exports: [ai_contacts_service_1.AiContactsService],
    })
], AiContactsModule);
//# sourceMappingURL=ai-contacts.module.js.map