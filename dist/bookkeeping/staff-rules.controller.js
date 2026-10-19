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
var StaffRulesController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaffRulesController = void 0;
const common_1 = require("@nestjs/common");
const customer_accounts_service_1 = require("./customer-accounts.service");
const agency_dto_1 = require("./dto/agency.dto");
const name_memory_service_1 = require("./name-memory.service");
const product_memory_service_1 = require("./product-memory.service");
const scope_1 = require("./scope");
const staff_book_guard_1 = require("./staff-book.guard");
const staff_rules_service_1 = require("./staff-rules.service");
let StaffRulesController = StaffRulesController_1 = class StaffRulesController {
    rules;
    accounts;
    nameMemory;
    productMemory;
    logger = new common_1.Logger(StaffRulesController_1.name);
    constructor(rules, accounts, nameMemory, productMemory) {
        this.rules = rules;
        this.accounts = accounts;
        this.nameMemory = nameMemory;
        this.productMemory = productMemory;
    }
    view(_companyId, staff) {
        return this.rules.view(staff.scope);
    }
    async saveNameRule(_companyId, staff, dto) {
        const { name, category } = await this.accounts.editValues(staff.scope, dto);
        await this.nameMemory.saveRule(staff.scope, {
            matchType: dto.matchType,
            matchKey: dto.matchKey,
            name,
            category,
            scope: 'ALWAYS',
        });
        this.log(staff, `saved ${dto.matchType} rule "${dto.matchKey}"`);
        return this.rules.view(staff.scope);
    }
    async resetNameRule(_companyId, staff, dto) {
        await this.nameMemory.resetRule(staff.scope, dto);
        this.log(staff, `removed ${dto.matchType} rule "${dto.matchKey}"`);
        return this.rules.view(staff.scope);
    }
    async saveItemRule(_companyId, staff, dto) {
        await this.productMemory.saveRule(staff.scope, dto.itemKey, dto.category);
        this.log(staff, `saved item rule "${dto.itemKey}"`);
        return this.rules.view(staff.scope);
    }
    async resetItemRule(_companyId, staff, dto) {
        await this.productMemory.resetRule(staff.scope, dto.itemKey);
        this.log(staff, `removed item rule "${dto.itemKey}"`);
        return this.rules.view(staff.scope);
    }
    log(staff, what) {
        this.logger.log(`staff user #${staff.staffUserId} ${what} for ${(0, scope_1.bookLabel)(staff.scope)}`);
    }
};
exports.StaffRulesController = StaffRulesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, staff_book_guard_1.Staff)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], StaffRulesController.prototype, "view", null);
__decorate([
    (0, common_1.Put)('names'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, staff_book_guard_1.Staff)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, agency_dto_1.SaveNameRuleDto]),
    __metadata("design:returntype", Promise)
], StaffRulesController.prototype, "saveNameRule", null);
__decorate([
    (0, common_1.Delete)('names'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, staff_book_guard_1.Staff)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, agency_dto_1.ResetNameRuleDto]),
    __metadata("design:returntype", Promise)
], StaffRulesController.prototype, "resetNameRule", null);
__decorate([
    (0, common_1.Put)('items'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, staff_book_guard_1.Staff)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, agency_dto_1.SaveProductRuleDto]),
    __metadata("design:returntype", Promise)
], StaffRulesController.prototype, "saveItemRule", null);
__decorate([
    (0, common_1.Delete)('items'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, staff_book_guard_1.Staff)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, agency_dto_1.ResetProductRuleDto]),
    __metadata("design:returntype", Promise)
], StaffRulesController.prototype, "resetItemRule", null);
exports.StaffRulesController = StaffRulesController = StaffRulesController_1 = __decorate([
    (0, common_1.Controller)('staff/books/:companyId/rules'),
    (0, common_1.UseGuards)(staff_book_guard_1.StaffBookGuard),
    __metadata("design:paramtypes", [staff_rules_service_1.StaffRulesService,
        customer_accounts_service_1.CustomerAccountsService,
        name_memory_service_1.NameMemoryService,
        product_memory_service_1.ProductMemoryService])
], StaffRulesController);
//# sourceMappingURL=staff-rules.controller.js.map