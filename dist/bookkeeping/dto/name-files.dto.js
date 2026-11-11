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
exports.WelcomeEmailDto = exports.PhoneUploadLinkDto = exports.AddNameDto = exports.RenameNameFolderDto = exports.CreateNameFolderDto = exports.PlaceAttachmentDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const trim = ({ value }) => typeof value === 'string' ? value.trim() : value;
class PlaceAttachmentDto {
    name;
    folderId;
    displayName;
}
exports.PlaceAttachmentDto = PlaceAttachmentDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(191),
    __metadata("design:type", Object)
], PlaceAttachmentDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Object)
], PlaceAttachmentDto.prototype, "folderId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", Object)
], PlaceAttachmentDto.prototype, "displayName", void 0);
class CreateNameFolderDto {
    name;
    parentId;
    title;
}
exports.CreateNameFolderDto = CreateNameFolderDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(191),
    __metadata("design:type", Object)
], CreateNameFolderDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Object)
], CreateNameFolderDto.prototype, "parentId", void 0);
__decorate([
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Give the folder a name' }),
    (0, class_validator_1.MaxLength)(128),
    __metadata("design:type", String)
], CreateNameFolderDto.prototype, "title", void 0);
class RenameNameFolderDto {
    title;
}
exports.RenameNameFolderDto = RenameNameFolderDto;
__decorate([
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Give the folder a name' }),
    (0, class_validator_1.MaxLength)(128),
    __metadata("design:type", String)
], RenameNameFolderDto.prototype, "title", void 0);
class AddNameDto {
    name;
    group;
}
exports.AddNameDto = AddNameDto;
__decorate([
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Give the name' }),
    (0, class_validator_1.MaxLength)(191),
    __metadata("design:type", String)
], AddNameDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^(CUSTOMER|SUPPLIER|OTHER|g\d+)$/, { message: 'Pick a group' }),
    __metadata("design:type", Object)
], AddNameDto.prototype, "group", void 0);
class PhoneUploadLinkDto {
    name;
    folderId;
}
exports.PhoneUploadLinkDto = PhoneUploadLinkDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(191),
    __metadata("design:type", Object)
], PhoneUploadLinkDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Object)
], PhoneUploadLinkDto.prototype, "folderId", void 0);
class WelcomeEmailDto {
    to;
}
exports.WelcomeEmailDto = WelcomeEmailDto;
__decorate([
    (0, class_transformer_1.Transform)(trim),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)({ message: 'Type an email address' }),
    (0, class_validator_1.MaxLength)(191),
    __metadata("design:type", String)
], WelcomeEmailDto.prototype, "to", void 0);
//# sourceMappingURL=name-files.dto.js.map