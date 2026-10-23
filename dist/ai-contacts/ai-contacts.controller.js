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
exports.AiContactsController = void 0;
const common_1 = require("@nestjs/common");
const customer_jwt_guard_1 = require("../customer-auth/customer-jwt.guard");
const ai_contacts_service_1 = require("./ai-contacts.service");
const contact_dto_1 = require("./dto/contact.dto");
let AiContactsController = class AiContactsController {
    contacts;
    constructor(contacts) {
        this.contacts = contacts;
    }
    list(req) {
        return this.contacts.list(req.user.customerId);
    }
    create(req, dto) {
        return this.contacts.create(req.user.customerId, dto);
    }
    update(req, id, dto) {
        return this.contacts.update(req.user.customerId, id, dto);
    }
    remove(req, id) {
        return this.contacts.remove(req.user.customerId, id);
    }
};
exports.AiContactsController = AiContactsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AiContactsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, contact_dto_1.CreateContactDto]),
    __metadata("design:returntype", Promise)
], AiContactsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, contact_dto_1.UpdateContactDto]),
    __metadata("design:returntype", Promise)
], AiContactsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], AiContactsController.prototype, "remove", null);
exports.AiContactsController = AiContactsController = __decorate([
    (0, common_1.Controller)('contacts'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard),
    __metadata("design:paramtypes", [ai_contacts_service_1.AiContactsService])
], AiContactsController);
//# sourceMappingURL=ai-contacts.controller.js.map