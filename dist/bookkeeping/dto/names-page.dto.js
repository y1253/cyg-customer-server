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
exports.NamesSearchDto = exports.NamesPageDto = void 0;
exports.namesPageOf = namesPageOf;
const class_validator_1 = require("class-validator");
const INT = /^\d+$/;
class NamesPageDto {
    offset;
    limit;
    filter;
    q;
}
exports.NamesPageDto = NamesPageDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(INT),
    __metadata("design:type", String)
], NamesPageDto.prototype, "offset", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(INT),
    __metadata("design:type", String)
], NamesPageDto.prototype, "limit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^(ALL|CUSTOMER|SUPPLIER|OTHER|g\d+)$/),
    __metadata("design:type", String)
], NamesPageDto.prototype, "filter", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], NamesPageDto.prototype, "q", void 0);
const MAX_PAGE = 200;
function namesPageOf(dto) {
    return {
        filter: dto.filter ?? 'ALL',
        q: dto.q ?? '',
        offset: Number(dto.offset ?? 0),
        limit: Math.min(Math.max(Number(dto.limit ?? 40), 1), MAX_PAGE),
    };
}
class NamesSearchDto {
    q;
}
exports.NamesSearchDto = NamesSearchDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], NamesSearchDto.prototype, "q", void 0);
//# sourceMappingURL=names-page.dto.js.map