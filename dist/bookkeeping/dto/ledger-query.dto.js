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
exports.LedgerQueryDto = void 0;
exports.ledgerQueryOf = ledgerQueryOf;
const class_validator_1 = require("class-validator");
const common_1 = require("@nestjs/common");
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const INT = /^\d+$/;
const INT_LIST = /^\d+(,\d+)*$/;
class LedgerQueryDto {
    offset;
    limit;
    q;
    statementIds;
    account;
    focusId;
    name;
    description;
    subNameId;
    from;
    to;
    filters;
    sort;
    folded;
    nearAmount;
    nearDate;
    near;
}
exports.LedgerQueryDto = LedgerQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(INT),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "offset", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(INT),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "limit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "q", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(INT_LIST),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "statementIds", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(191),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "account", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(INT),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "focusId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(191),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "description", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(INT),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "subNameId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(ISO_DAY),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "from", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(ISO_DAY),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "to", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(4000),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "filters", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "sort", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^[01]$/),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "folded", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^-?\d+(\.\d+)?$/),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "nearAmount", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(ISO_DAY),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "nearDate", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.Matches)(/^1$/),
    __metadata("design:type", String)
], LedgerQueryDto.prototype, "near", void 0);
const MAX_PAGE = 500;
function json(text, what) {
    if (!text)
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        throw new common_1.BadRequestException(`${what} must be JSON`);
    }
}
function ledgerQueryOf(dto) {
    const filters = json(dto.filters, 'filters');
    if (filters !== undefined &&
        (typeof filters !== 'object' || filters === null))
        throw new common_1.BadRequestException('filters must be an object');
    const sort = json(dto.sort, 'sort');
    if (sort &&
        (typeof sort.key !== 'string' ||
            (sort.dir !== 'asc' && sort.dir !== 'desc')))
        throw new common_1.BadRequestException('sort must be {key, dir: asc | desc}');
    return {
        query: {
            q: dto.q,
            statementIds: dto.statementIds?.split(',').map(Number),
            account: dto.account,
            focusId: dto.focusId ? Number(dto.focusId) : undefined,
            name: dto.name,
            description: dto.description,
            subNameId: dto.subNameId ? Number(dto.subNameId) : undefined,
            from: dto.from,
            to: dto.to,
            filters,
            sort: sort ?? null,
            folded: dto.folded === '1',
            near: dto.near === '1'
                ? {
                    amount: dto.nearAmount ? Number(dto.nearAmount) : null,
                    date: dto.nearDate ?? null,
                }
                : undefined,
        },
        offset: dto.offset ? Number(dto.offset) : 0,
        limit: Math.min(MAX_PAGE, Math.max(1, dto.limit ? Number(dto.limit) : 100)),
    };
}
//# sourceMappingURL=ledger-query.dto.js.map