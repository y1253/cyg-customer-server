"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceModule = void 0;
const common_1 = require("@nestjs/common");
const assistant_module_1 = require("../assistant/assistant.module");
const bookkeeping_module_1 = require("../bookkeeping/bookkeeping.module");
const customer_auth_module_1 = require("../customer-auth/customer-auth.module");
const messaging_module_1 = require("../messaging/messaging.module");
const voice_calls_service_1 = require("./voice-calls.service");
const voice_controller_1 = require("./voice.controller");
const voice_gateway_1 = require("./voice.gateway");
let VoiceModule = class VoiceModule {
};
exports.VoiceModule = VoiceModule;
exports.VoiceModule = VoiceModule = __decorate([
    (0, common_1.Module)({
        imports: [
            assistant_module_1.AssistantModule,
            bookkeeping_module_1.BookkeepingModule,
            customer_auth_module_1.CustomerAuthModule,
            messaging_module_1.MessagingModule,
        ],
        controllers: [voice_controller_1.VoiceStatusController, voice_controller_1.VoiceRecordingController],
        providers: [voice_calls_service_1.VoiceCallsService, voice_gateway_1.VoiceGateway],
        exports: [voice_calls_service_1.VoiceCallsService],
    })
], VoiceModule);
//# sourceMappingURL=voice.module.js.map