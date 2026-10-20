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
exports.IntakeAgentDto = exports.IntakeRouteDto = exports.AttachmentChatDto = exports.ChatDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
class ChatDto {
    conversationId;
    text;
}
exports.ChatDto = ChatDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], ChatDto.prototype, "conversationId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(1, 4000),
    __metadata("design:type", String)
], ChatDto.prototype, "text", void 0);
class AttachmentChatDto {
    text;
}
exports.AttachmentChatDto = AttachmentChatDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(1, 4000),
    __metadata("design:type", String)
], AttachmentChatDto.prototype, "text", void 0);
class IntakeRouteDto {
    channel;
    peer;
}
exports.IntakeRouteDto = IntakeRouteDto;
__decorate([
    (0, class_validator_1.IsIn)(['SMS', 'WHATSAPP']),
    __metadata("design:type", String)
], IntakeRouteDto.prototype, "channel", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(3, 32),
    __metadata("design:type", String)
], IntakeRouteDto.prototype, "peer", void 0);
class IntakeAgentDto extends IntakeRouteDto {
    text;
    attachmentIds;
}
exports.IntakeAgentDto = IntakeAgentDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(4000),
    __metadata("design:type", Object)
], IntakeAgentDto.prototype, "text", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(20),
    (0, class_validator_1.IsInt)({ each: true }),
    __metadata("design:type", Array)
], IntakeAgentDto.prototype, "attachmentIds", void 0);
//# sourceMappingURL=assistant.dto.js.map