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
var StaffBankFeedsController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaffBankFeedsController = void 0;
const common_1 = require("@nestjs/common");
const scope_1 = require("../bookkeeping/scope");
const staff_book_guard_1 = require("../bookkeeping/staff-book.guard");
const bank_feeds_service_1 = require("./bank-feeds.service");
const bank_feeds_dto_1 = require("./dto/bank-feeds.dto");
let StaffBankFeedsController = StaffBankFeedsController_1 = class StaffBankFeedsController {
    feeds;
    logger = new common_1.Logger(StaffBankFeedsController_1.name);
    constructor(feeds) {
        this.feeds = feeds;
    }
    config() {
        return { enabled: this.feeds.enabled };
    }
    list(staff) {
        return this.feeds.list(staff.scope);
    }
    linkToken(_companyId, staff, itemId, accounts) {
        if (itemId !== undefined && !/^[1-9]\d{0,9}$/.test(itemId)) {
            throw new common_1.BadRequestException('Invalid connection');
        }
        return this.feeds.linkToken(staff.scope, itemId ? Number(itemId) : undefined, accounts === '1', true);
    }
    async exchange(_companyId, staff, dto) {
        const view = await this.feeds.exchange(staff.scope, dto.publicToken);
        this.log(staff, `connected ${view.institutionName ?? 'a bank'} (#${view.id})`);
        return view;
    }
    reconnected(staff, id) {
        return this.feeds.reconnected(staff.scope, id);
    }
    setStartDates(staff, id, dto) {
        return this.feeds.setStartDates(staff.scope, id, dto.accounts);
    }
    refresh(staff, id) {
        return this.feeds.refresh(staff.scope, id);
    }
    async remove(staff, id) {
        await this.feeds.remove(staff.scope, id);
        this.log(staff, `disconnected bank #${id}`);
    }
    log(staff, what) {
        this.logger.log(`staff user #${staff.staffUserId} ${what} for ${(0, scope_1.bookLabel)(staff.scope)}`);
    }
};
exports.StaffBankFeedsController = StaffBankFeedsController;
__decorate([
    (0, common_1.Get)('config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], StaffBankFeedsController.prototype, "config", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, staff_book_guard_1.Staff)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], StaffBankFeedsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)('link-token'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, staff_book_guard_1.Staff)()),
    __param(2, (0, common_1.Query)('itemId')),
    __param(3, (0, common_1.Query)('accounts')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, String, String]),
    __metadata("design:returntype", Promise)
], StaffBankFeedsController.prototype, "linkToken", null);
__decorate([
    (0, common_1.Post)('exchange'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, staff_book_guard_1.Staff)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, bank_feeds_dto_1.ExchangeDto]),
    __metadata("design:returntype", Promise)
], StaffBankFeedsController.prototype, "exchange", null);
__decorate([
    (0, common_1.Post)(':id/reconnected'),
    __param(0, (0, staff_book_guard_1.Staff)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], StaffBankFeedsController.prototype, "reconnected", null);
__decorate([
    (0, common_1.Put)(':id/accounts'),
    __param(0, (0, staff_book_guard_1.Staff)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, bank_feeds_dto_1.StartDatesDto]),
    __metadata("design:returntype", Promise)
], StaffBankFeedsController.prototype, "setStartDates", null);
__decorate([
    (0, common_1.Post)(':id/sync'),
    __param(0, (0, staff_book_guard_1.Staff)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], StaffBankFeedsController.prototype, "refresh", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, staff_book_guard_1.Staff)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], StaffBankFeedsController.prototype, "remove", null);
exports.StaffBankFeedsController = StaffBankFeedsController = StaffBankFeedsController_1 = __decorate([
    (0, common_1.Controller)('staff/books/:companyId/bank-feeds'),
    (0, common_1.UseGuards)(staff_book_guard_1.StaffBookGuard),
    __metadata("design:paramtypes", [bank_feeds_service_1.BankFeedsService])
], StaffBankFeedsController);
//# sourceMappingURL=staff-bank-feeds.controller.js.map