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
exports.SchedulesController = exports.UpdateAiScheduleDto = exports.UpdateScheduleDto = void 0;
const common_1 = require("@nestjs/common");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const book_scope_guard_1 = require("../bookkeeping/book-scope.guard");
const customer_jwt_guard_1 = require("../customer-auth/customer-jwt.guard");
const ai_schedules_service_1 = require("./ai-schedules.service");
const ai_schedules_store_1 = require("./ai-schedules.store");
const next_run_util_1 = require("./next-run.util");
const schedules_service_1 = require("./schedules.service");
class UpdateScheduleDto {
    enabled;
    frequency;
    weekday;
    monthDay;
    time;
    timezone;
}
exports.UpdateScheduleDto = UpdateScheduleDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateScheduleDto.prototype, "enabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(next_run_util_1.FREQUENCIES),
    __metadata("design:type", String)
], UpdateScheduleDto.prototype, "frequency", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, v) => v !== null),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(6),
    __metadata("design:type", Object)
], UpdateScheduleDto.prototype, "weekday", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, v) => v !== null),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(28),
    __metadata("design:type", Object)
], UpdateScheduleDto.prototype, "monthDay", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Choose a time like 14:00' }),
    __metadata("design:type", String)
], UpdateScheduleDto.prototype, "time", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], UpdateScheduleDto.prototype, "timezone", void 0);
class UpdateAiScheduleDto {
    title;
    task;
    active;
    frequency;
    weekday;
    monthDay;
    time;
    timezone;
    channel;
}
exports.UpdateAiScheduleDto = UpdateAiScheduleDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], UpdateAiScheduleDto.prototype, "title", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(4000),
    __metadata("design:type", String)
], UpdateAiScheduleDto.prototype, "task", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateAiScheduleDto.prototype, "active", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(next_run_util_1.AI_FREQUENCIES),
    __metadata("design:type", String)
], UpdateAiScheduleDto.prototype, "frequency", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, v) => v !== null),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(6),
    __metadata("design:type", Object)
], UpdateAiScheduleDto.prototype, "weekday", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, v) => v !== null),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(28),
    __metadata("design:type", Object)
], UpdateAiScheduleDto.prototype, "monthDay", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Choose a time like 06:00' }),
    __metadata("design:type", String)
], UpdateAiScheduleDto.prototype, "time", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], UpdateAiScheduleDto.prototype, "timezone", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateIf)((_, v) => v !== null),
    (0, class_validator_1.IsIn)(ai_schedules_store_1.AI_SCHEDULE_CHANNELS),
    __metadata("design:type", Object)
], UpdateAiScheduleDto.prototype, "channel", void 0);
let SchedulesController = class SchedulesController {
    schedules;
    aiSchedules;
    constructor(schedules, aiSchedules) {
        this.schedules = schedules;
        this.aiSchedules = aiSchedules;
    }
    listCustom(scope) {
        return this.aiSchedules.list(scope);
    }
    updateCustom(scope, id, dto) {
        return this.aiSchedules.update(scope, id, dto);
    }
    removeCustom(scope, id) {
        return this.aiSchedules.remove(scope, id);
    }
    sendNowCustom(scope, id) {
        return this.aiSchedules.sendNow(scope, id);
    }
    list(scope) {
        return this.schedules.list(scope);
    }
    update(scope, type, dto) {
        return this.schedules.update(scope, schedules_service_1.SchedulesService.typeOf(type), dto);
    }
    sendNow(scope, type) {
        return this.schedules.sendNow(scope, schedules_service_1.SchedulesService.typeOf(type));
    }
};
exports.SchedulesController = SchedulesController;
__decorate([
    (0, common_1.Get)('custom'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SchedulesController.prototype, "listCustom", null);
__decorate([
    (0, common_1.Put)('custom/:id'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, UpdateAiScheduleDto]),
    __metadata("design:returntype", Promise)
], SchedulesController.prototype, "updateCustom", null);
__decorate([
    (0, common_1.Delete)('custom/:id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], SchedulesController.prototype, "removeCustom", null);
__decorate([
    (0, common_1.Post)('custom/:id/send-now'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], SchedulesController.prototype, "sendNowCustom", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SchedulesController.prototype, "list", null);
__decorate([
    (0, common_1.Put)(':type'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('type')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, UpdateScheduleDto]),
    __metadata("design:returntype", Promise)
], SchedulesController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(':type/send-now'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('type')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SchedulesController.prototype, "sendNow", null);
exports.SchedulesController = SchedulesController = __decorate([
    (0, common_1.Controller)('bookkeeping/schedules'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard, book_scope_guard_1.BookScopeGuard),
    __metadata("design:paramtypes", [schedules_service_1.SchedulesService,
        ai_schedules_service_1.AiSchedulesService])
], SchedulesController);
//# sourceMappingURL=schedules.controller.js.map