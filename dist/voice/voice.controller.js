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
exports.VoiceRecordingController = exports.VoiceStatusController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const book_scope_guard_1 = require("../bookkeeping/book-scope.guard");
const customer_jwt_guard_1 = require("../customer-auth/customer-jwt.guard");
const voice_calls_service_1 = require("./voice-calls.service");
const voice_util_1 = require("./voice.util");
let VoiceStatusController = class VoiceStatusController {
    calls;
    config;
    constructor(calls, config) {
        this.calls = calls;
        this.config = config;
    }
    async status(req, body) {
        const signature = req.headers['x-signalwire-signature'] ??
            req.headers['x-twilio-signature'];
        const ok = (0, voice_util_1.signalWireSignatureValid)(this.calls.statusUrl(), body, signature, this.config.get('SIGNALWIRE_SIGN_KEY')?.trim());
        if (!ok)
            throw new common_1.ForbiddenException();
        const sid = typeof body.CallSid === 'string' ? body.CallSid : null;
        const status = typeof body.CallStatus === 'string' ? body.CallStatus : '';
        const duration = Number(body.CallDuration);
        if (sid) {
            await this.calls.onStatus(sid, status, Number.isFinite(duration) ? duration : null);
        }
    }
};
exports.VoiceStatusController = VoiceStatusController;
__decorate([
    (0, common_1.Post)('status'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], VoiceStatusController.prototype, "status", null);
exports.VoiceStatusController = VoiceStatusController = __decorate([
    (0, common_1.Controller)('voice'),
    __metadata("design:paramtypes", [voice_calls_service_1.VoiceCallsService,
        config_1.ConfigService])
], VoiceStatusController);
let VoiceRecordingController = class VoiceRecordingController {
    calls;
    constructor(calls) {
        this.calls = calls;
    }
    async recording(scope, id, res) {
        const r = await this.calls.recording(scope, id);
        res.set({
            'Content-Type': r.contentType,
            'Content-Length': String(r.body.length),
            'Content-Disposition': `inline; filename="${r.filename}"`,
            'Cache-Control': 'private, no-store',
        });
        return new common_1.StreamableFile(r.body);
    }
};
exports.VoiceRecordingController = VoiceRecordingController;
__decorate([
    (0, common_1.Get)(':id/recording'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], VoiceRecordingController.prototype, "recording", null);
exports.VoiceRecordingController = VoiceRecordingController = __decorate([
    (0, common_1.Controller)('bookkeeping/calls'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard, book_scope_guard_1.BookScopeGuard),
    __metadata("design:paramtypes", [voice_calls_service_1.VoiceCallsService])
], VoiceRecordingController);
//# sourceMappingURL=voice.controller.js.map