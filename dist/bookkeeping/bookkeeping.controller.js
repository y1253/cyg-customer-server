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
exports.BookkeepingController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const customer_auth_service_1 = require("../customer-auth/customer-auth.service");
const customer_jwt_guard_1 = require("../customer-auth/customer-jwt.guard");
const attachments_service_1 = require("./attachments.service");
const attachment_uploads_1 = require("./attachment-uploads");
const bookkeeping_service_1 = require("./bookkeeping.service");
const customer_accounts_service_1 = require("./customer-accounts.service");
const name_memory_service_1 = require("./name-memory.service");
const product_memory_service_1 = require("./product-memory.service");
const agency_dto_1 = require("./dto/agency.dto");
const reports_query_dto_1 = require("./dto/reports-query.dto");
const export_service_1 = require("./export.service");
const fx_service_1 = require("./fx.service");
const reports_service_1 = require("./reports.service");
const splits_service_1 = require("./splits.service");
const tax_service_1 = require("./tax.service");
const reports_util_1 = require("./reports.util");
const statement_uploads_1 = require("./statement-uploads");
function attachment(filename, inline = false) {
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
let BookkeepingController = class BookkeepingController {
    bookkeeping;
    exporter;
    customers;
    reportsService;
    tax;
    nameMemory;
    accounts;
    splits;
    attachments;
    productMemory;
    fx;
    constructor(bookkeeping, exporter, customers, reportsService, tax, nameMemory, accounts, splits, attachments, productMemory, fx) {
        this.bookkeeping = bookkeeping;
        this.exporter = exporter;
        this.customers = customers;
        this.reportsService = reportsService;
        this.tax = tax;
        this.nameMemory = nameMemory;
        this.accounts = accounts;
        this.splits = splits;
        this.attachments = attachments;
        this.productMemory = productMemory;
        this.fx = fx;
    }
    generate(req) {
        return this.bookkeeping.generateIfFree(req.user.customerId);
    }
    taxSettings(req) {
        return this.tax.settings(req.user.customerId);
    }
    createAgency(req, dto) {
        return this.tax.createAgency(req.user.customerId, dto);
    }
    updateAgency(req, id, dto) {
        return this.tax.updateAgency(req.user.customerId, id, dto);
    }
    removeAgency(req, id) {
        return this.tax.removeAgency(req.user.customerId, id);
    }
    names(req) {
        return this.tax.names(req.user.customerId);
    }
    setNameAgencies(req, dto) {
        return this.tax.setNameAgencies(req.user.customerId, dto.name, dto.agencyIds);
    }
    async saveNameRule(req, dto) {
        const { name, category } = await this.editValues(req.user.customerId, dto);
        await this.nameMemory.saveRule(req.user.customerId, {
            matchType: dto.matchType,
            matchKey: dto.matchKey,
            name,
            category,
            scope: dto.scope ?? 'ALWAYS',
        });
        return this.tax.names(req.user.customerId);
    }
    async editTransaction(req, id, dto) {
        const { name, category } = await this.editValues(req.user.customerId, dto);
        await this.nameMemory.editTransaction(req.user.customerId, id, {
            name,
            category,
            scope: dto.scope,
        });
    }
    saveSplits(req, id, dto) {
        return this.splits.save(req.user.customerId, id, dto.splits);
    }
    async renameTaxLine(req, id, agencyId, dto) {
        const ok = await this.tax.renameLine(req.user.customerId, id, agencyId, dto.name?.trim() || null);
        if (!ok)
            throw new common_1.NotFoundException('Tax line not found');
    }
    async editValues(customerId, dto) {
        const name = dto.name?.trim() || null;
        const raw = dto.category?.trim() || null;
        if (!name && !raw) {
            throw new common_1.BadRequestException('Enter a name or choose a category');
        }
        if (name && name.toLowerCase() === reports_util_1.UNCLARIFIED_NAME.toLowerCase()) {
            throw new common_1.BadRequestException(`"${reports_util_1.UNCLARIFIED_NAME}" is kept for rows with no name — enter the real name`);
        }
        const category = raw
            ? await this.accounts.validCategory(customerId, raw)
            : null;
        return { name, category };
    }
    async resetNameRule(req, dto) {
        await this.nameMemory.resetRule(req.user.customerId, dto);
        return this.tax.names(req.user.customerId);
    }
    products(req) {
        return this.productMemory.products(req.user.customerId);
    }
    async saveProductRule(req, dto) {
        await this.productMemory.saveRule(req.user.customerId, dto.itemKey, dto.category);
        return this.productMemory.products(req.user.customerId);
    }
    async resetProductRule(req, dto) {
        await this.productMemory.resetRule(req.user.customerId, dto.itemKey);
        return this.productMemory.products(req.user.customerId);
    }
    uploadAttachments(req, files, rawTransactionId) {
        const transactionId = rawTransactionId ? Number(rawTransactionId) : null;
        if (transactionId !== null &&
            (!Number.isInteger(transactionId) || transactionId < 1)) {
            throw new common_1.BadRequestException('transactionId must be a transaction id');
        }
        return this.attachments.upload(req.user.customerId, files, transactionId);
    }
    intake(req) {
        return this.attachments.intake(req.user.customerId);
    }
    listAttachments(req) {
        return this.attachments.list(req.user.customerId);
    }
    async attachmentFile(req, id, res) {
        const f = await this.attachments.file(req.user.customerId, id);
        res.set({
            'Content-Type': f.mimeType,
            'Content-Length': String(f.size),
            'Content-Disposition': attachment(f.filename, true),
            'Cache-Control': 'private, no-store',
        });
        return new common_1.StreamableFile(f.stream);
    }
    setAttachmentTransaction(req, id, dto) {
        return this.attachments.setTransaction(req.user.customerId, id, dto.transactionId ?? null);
    }
    applyAttachmentItems(req, id) {
        return this.attachments.applyItems(req.user.customerId, id);
    }
    retryAttachment(req, id) {
        return this.attachments.retry(req.user.customerId, id);
    }
    removeAttachment(req, id) {
        return this.attachments.remove(req.user.customerId, id);
    }
    upload(req, files) {
        return this.bookkeeping.upload(req.user.customerId, files);
    }
    list(req) {
        return this.bookkeeping.list(req.user.customerId);
    }
    transactions(req, statementIds) {
        const ids = statementIds
            ? statementIds
                .split(',')
                .map((s) => Number(s))
                .filter((n) => Number.isInteger(n) && n > 0)
            : undefined;
        return this.bookkeeping.transactions(req.user.customerId, ids);
    }
    async file(req, id, res) {
        const f = await this.bookkeeping.file(req.user.customerId, id);
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Length': String(f.size),
            'Content-Disposition': attachment(f.filename, true),
            'Cache-Control': 'private, no-store',
        });
        return new common_1.StreamableFile(f.stream);
    }
    retry(req, id) {
        return this.bookkeeping.retry(req.user.customerId, id);
    }
    remove(req, id) {
        return this.bookkeeping.remove(req.user.customerId, id);
    }
    async export(req, format, res) {
        if (format !== 'xlsx' && format !== 'pdf') {
            throw new common_1.BadRequestException('format must be xlsx or pdf');
        }
        const me = await this.customers.me(req.user.customerId);
        const rows = await this.exporter.rowsFor(req.user.customerId);
        const stamp = new Date().toISOString().slice(0, 10);
        const buf = format === 'xlsx'
            ? await this.exporter.excel(rows, me.name)
            : await this.exporter.pdf(rows, me.name);
        res.set({
            'Content-Type': format === 'xlsx'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : 'application/pdf',
            'Content-Disposition': attachment(`ledger-${stamp}.${format}`),
            'Cache-Control': 'private, no-store',
        });
        return new common_1.StreamableFile(buf);
    }
    reports(req, q) {
        if (q.from && q.to && q.from > q.to) {
            throw new common_1.BadRequestException('from must be on or before to');
        }
        return this.reportsService.reports(req.user.customerId, q.from ?? null, q.to ?? null);
    }
    accountList(req) {
        return this.accounts.list(req.user.customerId);
    }
    createAccount(req, dto) {
        return this.accounts.create(req.user.customerId, dto);
    }
    setAccountType(req, dto) {
        return this.accounts.setType(req.user.customerId, dto.account, dto.type);
    }
    resetAccountType(req, dto) {
        return this.accounts.resetType(req.user.customerId, dto.account);
    }
    async currency(req) {
        return {
            home: await this.fx.home(req.user.customerId),
            currencies: this.fx.currencies(),
        };
    }
    async setCurrency(req, dto) {
        return {
            home: await this.fx.setHome(req.user.customerId, dto.home),
            currencies: this.fx.currencies(),
        };
    }
};
exports.BookkeepingController = BookkeepingController;
__decorate([
    (0, common_1.Post)('generate'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "generate", null);
__decorate([
    (0, common_1.Get)('tax'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "taxSettings", null);
__decorate([
    (0, common_1.Post)('agencies'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.CreateAgencyDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "createAgency", null);
__decorate([
    (0, common_1.Patch)('agencies/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, agency_dto_1.UpdateAgencyDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "updateAgency", null);
__decorate([
    (0, common_1.Delete)('agencies/:id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "removeAgency", null);
__decorate([
    (0, common_1.Get)('names'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "names", null);
__decorate([
    (0, common_1.Put)('names/agencies'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.SetNameAgenciesDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "setNameAgencies", null);
__decorate([
    (0, common_1.Put)('names/rule'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.SaveNameRuleDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "saveNameRule", null);
__decorate([
    (0, common_1.Patch)('transactions/:id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, agency_dto_1.EditTransactionDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "editTransaction", null);
__decorate([
    (0, common_1.Put)('transactions/:id/splits'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, agency_dto_1.SaveSplitsDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "saveSplits", null);
__decorate([
    (0, common_1.Patch)('transactions/:id/taxes/:agencyId'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)('agencyId', common_1.ParseIntPipe)),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Number, agency_dto_1.RenameTaxLineDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "renameTaxLine", null);
__decorate([
    (0, common_1.Delete)('names/rule'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.ResetNameRuleDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "resetNameRule", null);
__decorate([
    (0, common_1.Get)('products'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "products", null);
__decorate([
    (0, common_1.Put)('products/rule'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.SaveProductRuleDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "saveProductRule", null);
__decorate([
    (0, common_1.Delete)('products/rule'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.ResetProductRuleDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "resetProductRule", null);
__decorate([
    (0, common_1.Post)('attachments'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('files', attachment_uploads_1.MAX_FILES_PER_REQUEST, attachment_uploads_1.ATTACHMENT_UPLOAD_OPTIONS)),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.UploadedFiles)()),
    __param(2, (0, common_1.Body)('transactionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Array, String]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "uploadAttachments", null);
__decorate([
    (0, common_1.Get)('intake'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "intake", null);
__decorate([
    (0, common_1.Get)('attachments'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "listAttachments", null);
__decorate([
    (0, common_1.Get)('attachments/:id/file'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "attachmentFile", null);
__decorate([
    (0, common_1.Patch)('attachments/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, agency_dto_1.SetAttachmentTransactionDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "setAttachmentTransaction", null);
__decorate([
    (0, common_1.Post)('attachments/:id/apply-items'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "applyAttachmentItems", null);
__decorate([
    (0, common_1.Post)('attachments/:id/retry'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "retryAttachment", null);
__decorate([
    (0, common_1.Delete)('attachments/:id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "removeAttachment", null);
__decorate([
    (0, common_1.Post)('statements'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('files', statement_uploads_1.MAX_FILES_PER_REQUEST, statement_uploads_1.STATEMENT_UPLOAD_OPTIONS)),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Array]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "upload", null);
__decorate([
    (0, common_1.Get)('statements'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('transactions'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('statementIds')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "transactions", null);
__decorate([
    (0, common_1.Get)('statements/:id/file'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "file", null);
__decorate([
    (0, common_1.Post)('statements/:id/retry'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "retry", null);
__decorate([
    (0, common_1.Delete)('statements/:id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)('export'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('format')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "export", null);
__decorate([
    (0, common_1.Get)('reports'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, reports_query_dto_1.ReportsQueryDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "reports", null);
__decorate([
    (0, common_1.Get)('accounts'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "accountList", null);
__decorate([
    (0, common_1.Post)('accounts'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.CreateAccountDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "createAccount", null);
__decorate([
    (0, common_1.Put)('accounts/type'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.SetAccountTypeDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "setAccountType", null);
__decorate([
    (0, common_1.Delete)('accounts/type'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.ResetAccountTypeDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "resetAccountType", null);
__decorate([
    (0, common_1.Get)('currency'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "currency", null);
__decorate([
    (0, common_1.Put)('currency'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.SetCurrencyDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "setCurrency", null);
exports.BookkeepingController = BookkeepingController = __decorate([
    (0, common_1.Controller)('bookkeeping'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard),
    __metadata("design:paramtypes", [bookkeeping_service_1.BookkeepingService,
        export_service_1.LedgerExportService,
        customer_auth_service_1.CustomerAuthService,
        reports_service_1.ReportsService,
        tax_service_1.TaxService,
        name_memory_service_1.NameMemoryService,
        customer_accounts_service_1.CustomerAccountsService,
        splits_service_1.SplitsService,
        attachments_service_1.AttachmentsService,
        product_memory_service_1.ProductMemoryService,
        fx_service_1.FxService])
], BookkeepingController);
//# sourceMappingURL=bookkeeping.controller.js.map