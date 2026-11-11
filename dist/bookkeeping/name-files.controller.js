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
exports.PhoneUploadController = exports.NameFilesController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const promises_1 = require("fs/promises");
const customer_jwt_guard_1 = require("../customer-auth/customer-jwt.guard");
const book_scope_guard_1 = require("./book-scope.guard");
const attachment_uploads_1 = require("./attachment-uploads");
const attachments_service_1 = require("./attachments.service");
const name_files_dto_1 = require("./dto/name-files.dto");
const name_files_service_1 = require("./name-files.service");
const tax_service_1 = require("./tax.service");
let NameFilesController = class NameFilesController {
    files;
    attachments;
    tax;
    constructor(files, attachments, tax) {
        this.files = files;
        this.attachments = attachments;
        this.tax = tax;
    }
    place(scope, id, dto) {
        return this.attachments.place(scope, id, dto);
    }
    email(scope, id) {
        return this.files.email(scope, id);
    }
    folders(scope) {
        return this.files.folders(scope);
    }
    createFolder(scope, dto) {
        return this.files.createFolder(scope, dto.name ?? null, dto.parentId ?? null, dto.title);
    }
    renameFolder(scope, id, dto) {
        return this.files.renameFolder(scope, id, dto.title);
    }
    removeFolder(scope, id) {
        return this.files.removeFolder(scope, id);
    }
    async addName(scope, dto) {
        return { name: await this.tax.addName(scope, dto.name, dto.group ?? null) };
    }
    phoneUploadLink(scope, dto) {
        return this.files.phoneUploadLink(scope, dto);
    }
    welcomeEmail(scope, dto) {
        return this.files.welcomeEmail(scope, dto.to);
    }
};
exports.NameFilesController = NameFilesController;
__decorate([
    (0, common_1.Patch)('attachments/:id/place'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, name_files_dto_1.PlaceAttachmentDto]),
    __metadata("design:returntype", Promise)
], NameFilesController.prototype, "place", null);
__decorate([
    (0, common_1.Get)('attachments/:id/email'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], NameFilesController.prototype, "email", null);
__decorate([
    (0, common_1.Get)('name-folders'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], NameFilesController.prototype, "folders", null);
__decorate([
    (0, common_1.Post)('name-folders'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, name_files_dto_1.CreateNameFolderDto]),
    __metadata("design:returntype", Promise)
], NameFilesController.prototype, "createFolder", null);
__decorate([
    (0, common_1.Patch)('name-folders/:id'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, name_files_dto_1.RenameNameFolderDto]),
    __metadata("design:returntype", Promise)
], NameFilesController.prototype, "renameFolder", null);
__decorate([
    (0, common_1.Delete)('name-folders/:id'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], NameFilesController.prototype, "removeFolder", null);
__decorate([
    (0, common_1.Post)('names'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, name_files_dto_1.AddNameDto]),
    __metadata("design:returntype", Promise)
], NameFilesController.prototype, "addName", null);
__decorate([
    (0, common_1.Post)('phone-upload-link'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, name_files_dto_1.PhoneUploadLinkDto]),
    __metadata("design:returntype", Promise)
], NameFilesController.prototype, "phoneUploadLink", null);
__decorate([
    (0, common_1.Post)('welcome-email'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, name_files_dto_1.WelcomeEmailDto]),
    __metadata("design:returntype", Promise)
], NameFilesController.prototype, "welcomeEmail", null);
exports.NameFilesController = NameFilesController = __decorate([
    (0, common_1.Controller)('bookkeeping'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard, book_scope_guard_1.BookScopeGuard),
    __metadata("design:paramtypes", [name_files_service_1.NameFilesService,
        attachments_service_1.AttachmentsService,
        tax_service_1.TaxService])
], NameFilesController);
let PhoneUploadController = class PhoneUploadController {
    files;
    attachments;
    constructor(files, attachments) {
        this.files = files;
        this.attachments = attachments;
    }
    async info(token) {
        const t = await this.files.phoneUploadTarget(token);
        return { bookName: t.bookName, name: t.name };
    }
    async upload(token, files) {
        if (!files?.length)
            throw new common_1.BadRequestException('Choose a file to add');
        const t = await this.files.phoneUploadTarget(token).catch(async (err) => {
            await Promise.all(files.map((f) => (0, promises_1.unlink)(f.path).catch(() => undefined)));
            throw err;
        });
        const rows = await this.attachments.upload(t.scope, files, null, {
            name: t.name,
            folderId: t.folderId,
        });
        return rows.map((r) => ({ id: r.id, filename: r.filename }));
    }
};
exports.PhoneUploadController = PhoneUploadController;
__decorate([
    (0, common_1.Get)(':token'),
    __param(0, (0, common_1.Param)('token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PhoneUploadController.prototype, "info", null);
__decorate([
    (0, common_1.Post)(':token'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('files', attachment_uploads_1.MAX_FILES_PER_REQUEST, attachment_uploads_1.ATTACHMENT_UPLOAD_OPTIONS)),
    __param(0, (0, common_1.Param)('token')),
    __param(1, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Array]),
    __metadata("design:returntype", Promise)
], PhoneUploadController.prototype, "upload", null);
exports.PhoneUploadController = PhoneUploadController = __decorate([
    (0, common_1.Controller)('phone-upload'),
    __metadata("design:paramtypes", [name_files_service_1.NameFilesService,
        attachments_service_1.AttachmentsService])
], PhoneUploadController);
//# sourceMappingURL=name-files.controller.js.map