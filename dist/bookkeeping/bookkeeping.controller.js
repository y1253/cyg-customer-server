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
const prisma_service_1 = require("../prisma/prisma.service");
const book_scope_guard_1 = require("./book-scope.guard");
const books_1 = require("./books");
const attachments_service_1 = require("./attachments.service");
const attachment_uploads_1 = require("./attachment-uploads");
const bookkeeping_service_1 = require("./bookkeeping.service");
const customer_accounts_service_1 = require("./customer-accounts.service");
const communications_service_1 = require("./communications.service");
const communications_util_1 = require("./communications.util");
const name_memory_service_1 = require("./name-memory.service");
const product_memory_service_1 = require("./product-memory.service");
const agency_dto_1 = require("./dto/agency.dto");
const reports_query_dto_1 = require("./dto/reports-query.dto");
const export_service_1 = require("./export.service");
const fx_service_1 = require("./fx.service");
const reports_service_1 = require("./reports.service");
const splits_service_1 = require("./splits.service");
const tax_service_1 = require("./tax.service");
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
    prisma;
    communications;
    constructor(bookkeeping, exporter, customers, reportsService, tax, nameMemory, accounts, splits, attachments, productMemory, fx, prisma, communications) {
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
        this.prisma = prisma;
        this.communications = communications;
    }
    ownerName(scope) {
        return (0, books_1.bookOwnerName)(this.prisma, scope);
    }
    generate(scope) {
        return this.bookkeeping.generateIfFree(scope);
    }
    taxSettings(scope) {
        return this.tax.settings(scope);
    }
    createAgency(scope, dto) {
        return this.tax.createAgency(scope, dto);
    }
    updateAgency(scope, id, dto) {
        return this.tax.updateAgency(scope, id, dto);
    }
    removeAgency(scope, id) {
        return this.tax.removeAgency(scope, id);
    }
    names(scope) {
        return this.tax.names(scope);
    }
    setNameAgencies(scope, dto) {
        return this.tax.setNameAgencies(scope, dto.name, dto.agencyIds);
    }
    async saveNameRule(scope, dto) {
        const { name, category } = await this.accounts.editValues(scope, dto);
        await this.nameMemory.saveRule(scope, {
            matchType: dto.matchType,
            matchKey: dto.matchKey,
            name,
            category,
            scope: dto.scope ?? 'ALWAYS',
        });
        return this.tax.names(scope);
    }
    async editTransaction(scope, id, dto) {
        const { name, category } = await this.accounts.editValues(scope, dto);
        await this.nameMemory.editTransaction(scope, id, {
            name,
            category,
            scope: dto.scope,
        });
    }
    saveSplits(scope, id, dto) {
        return this.splits.save(scope, id, dto.splits);
    }
    async renameTaxLine(scope, id, agencyId, dto) {
        const ok = await this.tax.renameLine(scope, id, agencyId, dto.name?.trim() || null);
        if (!ok)
            throw new common_1.NotFoundException('Tax line not found');
    }
    async resetNameRule(scope, dto) {
        await this.nameMemory.resetRule(scope, dto);
        return this.tax.names(scope);
    }
    products(scope) {
        return this.productMemory.products(scope);
    }
    async saveProductRule(scope, dto) {
        await this.productMemory.saveRule(scope, dto.itemKey, dto.category);
        return this.productMemory.products(scope);
    }
    async resetProductRule(scope, dto) {
        await this.productMemory.resetRule(scope, dto.itemKey);
        return this.productMemory.products(scope);
    }
    uploadAttachments(scope, files, rawTransactionId) {
        const transactionId = rawTransactionId ? Number(rawTransactionId) : null;
        if (transactionId !== null &&
            (!Number.isInteger(transactionId) || transactionId < 1)) {
            throw new common_1.BadRequestException('transactionId must be a transaction id');
        }
        return this.attachments.upload(scope, files, transactionId);
    }
    communicationChannels(scope) {
        return this.communications.channels(scope);
    }
    communicationPage(scope, channel, before) {
        if (!(0, communications_util_1.isCommChannel)(channel))
            throw new common_1.NotFoundException();
        const at = before ? new Date(before) : null;
        if (at && Number.isNaN(at.getTime()))
            throw new common_1.BadRequestException('before must be a date');
        return this.communications.page(scope, channel, at);
    }
    intake(scope) {
        return this.attachments.intake(scope);
    }
    listAttachments(scope) {
        return this.attachments.list(scope);
    }
    async attachmentFile(scope, id, res) {
        const f = await this.attachments.file(scope, id);
        res.set({
            'Content-Type': f.mimeType,
            'Content-Length': String(f.size),
            'Content-Disposition': attachment(f.filename, true),
            'Cache-Control': 'private, no-store',
        });
        return new common_1.StreamableFile(f.stream);
    }
    setAttachmentTransaction(scope, id, dto) {
        return this.attachments.setTransaction(scope, id, dto.transactionId ?? null);
    }
    applyAttachmentItems(scope, id) {
        return this.attachments.applyItems(scope, id);
    }
    retryAttachment(scope, id) {
        return this.attachments.retry(scope, id);
    }
    removeAttachment(scope, id) {
        return this.attachments.remove(scope, id);
    }
    upload(scope, files) {
        return this.bookkeeping.upload(scope, files);
    }
    list(scope) {
        return this.bookkeeping.list(scope);
    }
    transactions(scope, statementIds) {
        const ids = statementIds
            ? statementIds
                .split(',')
                .map((s) => Number(s))
                .filter((n) => Number.isInteger(n) && n > 0)
            : undefined;
        return this.bookkeeping.transactions(scope, ids);
    }
    async file(scope, id, res) {
        const f = await this.bookkeeping.file(scope, id);
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Length': String(f.size),
            'Content-Disposition': attachment(f.filename, true),
            'Cache-Control': 'private, no-store',
        });
        return new common_1.StreamableFile(f.stream);
    }
    moveStatement(scope, id, dto) {
        return this.bookkeeping.moveStatement(scope, id, dto.accountName);
    }
    retry(scope, id) {
        return this.bookkeeping.retry(scope, id);
    }
    remove(scope, id) {
        return this.bookkeeping.remove(scope, id);
    }
    async export(scope, format, res) {
        if (format !== 'xlsx' && format !== 'pdf') {
            throw new common_1.BadRequestException('format must be xlsx or pdf');
        }
        const owner = await this.ownerName(scope);
        const rows = await this.exporter.rowsFor(scope);
        const stamp = new Date().toISOString().slice(0, 10);
        const buf = format === 'xlsx'
            ? await this.exporter.excel(rows, owner)
            : await this.exporter.pdf(rows, owner);
        res.set({
            'Content-Type': format === 'xlsx'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : 'application/pdf',
            'Content-Disposition': attachment(`ledger-${stamp}.${format}`),
            'Cache-Control': 'private, no-store',
        });
        return new common_1.StreamableFile(buf);
    }
    reports(scope, q) {
        if (q.from && q.to && q.from > q.to) {
            throw new common_1.BadRequestException('from must be on or before to');
        }
        return this.reportsService.reports(scope, q.from ?? null, q.to ?? null);
    }
    accountList(scope) {
        return this.accounts.list(scope);
    }
    createAccount(scope, dto) {
        return this.accounts.create(scope, dto);
    }
    setAccountType(scope, dto) {
        return this.accounts.setType(scope, dto.account, dto.type);
    }
    resetAccountType(scope, dto) {
        return this.accounts.resetType(scope, dto.account);
    }
    setAccountCurrency(scope, dto) {
        return this.accounts.setCurrency(scope, dto.account, dto.currency);
    }
    resetAccountCurrency(scope, dto) {
        return this.accounts.resetCurrency(scope, dto.account);
    }
    async currency(scope) {
        return {
            home: await this.fx.home(scope),
            currencies: this.fx.currencies(),
        };
    }
    async setCurrency(scope, dto) {
        return {
            home: await this.fx.setHome(scope, dto.home),
            currencies: this.fx.currencies(),
        };
    }
};
exports.BookkeepingController = BookkeepingController;
__decorate([
    (0, common_1.Post)('generate'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "generate", null);
__decorate([
    (0, common_1.Get)('tax'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "taxSettings", null);
__decorate([
    (0, common_1.Post)('agencies'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.CreateAgencyDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "createAgency", null);
__decorate([
    (0, common_1.Patch)('agencies/:id'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, agency_dto_1.UpdateAgencyDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "updateAgency", null);
__decorate([
    (0, common_1.Delete)('agencies/:id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "removeAgency", null);
__decorate([
    (0, common_1.Get)('names'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "names", null);
__decorate([
    (0, common_1.Put)('names/agencies'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.SetNameAgenciesDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "setNameAgencies", null);
__decorate([
    (0, common_1.Put)('names/rule'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.SaveNameRuleDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "saveNameRule", null);
__decorate([
    (0, common_1.Patch)('transactions/:id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, agency_dto_1.EditTransactionDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "editTransaction", null);
__decorate([
    (0, common_1.Put)('transactions/:id/splits'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, agency_dto_1.SaveSplitsDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "saveSplits", null);
__decorate([
    (0, common_1.Patch)('transactions/:id/taxes/:agencyId'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)('agencyId', common_1.ParseIntPipe)),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Number, agency_dto_1.RenameTaxLineDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "renameTaxLine", null);
__decorate([
    (0, common_1.Delete)('names/rule'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.ResetNameRuleDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "resetNameRule", null);
__decorate([
    (0, common_1.Get)('products'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "products", null);
__decorate([
    (0, common_1.Put)('products/rule'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.SaveProductRuleDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "saveProductRule", null);
__decorate([
    (0, common_1.Delete)('products/rule'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.ResetProductRuleDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "resetProductRule", null);
__decorate([
    (0, common_1.Post)('attachments'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('files', attachment_uploads_1.MAX_FILES_PER_REQUEST, attachment_uploads_1.ATTACHMENT_UPLOAD_OPTIONS)),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.UploadedFiles)()),
    __param(2, (0, common_1.Body)('transactionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Array, String]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "uploadAttachments", null);
__decorate([
    (0, common_1.Get)('communications'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "communicationChannels", null);
__decorate([
    (0, common_1.Get)('communications/:channel'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('channel')),
    __param(2, (0, common_1.Query)('before')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "communicationPage", null);
__decorate([
    (0, common_1.Get)('intake'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "intake", null);
__decorate([
    (0, common_1.Get)('attachments'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "listAttachments", null);
__decorate([
    (0, common_1.Get)('attachments/:id/file'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "attachmentFile", null);
__decorate([
    (0, common_1.Patch)('attachments/:id'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, agency_dto_1.SetAttachmentTransactionDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "setAttachmentTransaction", null);
__decorate([
    (0, common_1.Post)('attachments/:id/apply-items'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "applyAttachmentItems", null);
__decorate([
    (0, common_1.Post)('attachments/:id/retry'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "retryAttachment", null);
__decorate([
    (0, common_1.Delete)('attachments/:id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "removeAttachment", null);
__decorate([
    (0, common_1.Post)('statements'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('files', statement_uploads_1.MAX_FILES_PER_REQUEST, statement_uploads_1.STATEMENT_UPLOAD_OPTIONS)),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Array]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "upload", null);
__decorate([
    (0, common_1.Get)('statements'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('transactions'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Query)('statementIds')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "transactions", null);
__decorate([
    (0, common_1.Get)('statements/:id/file'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "file", null);
__decorate([
    (0, common_1.Patch)('statements/:id/account'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, agency_dto_1.MoveStatementDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "moveStatement", null);
__decorate([
    (0, common_1.Post)('statements/:id/retry'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "retry", null);
__decorate([
    (0, common_1.Delete)('statements/:id'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)('export'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Query)('format')),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "export", null);
__decorate([
    (0, common_1.Get)('reports'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, reports_query_dto_1.ReportsQueryDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "reports", null);
__decorate([
    (0, common_1.Get)('accounts'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "accountList", null);
__decorate([
    (0, common_1.Post)('accounts'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.CreateAccountDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "createAccount", null);
__decorate([
    (0, common_1.Put)('accounts/type'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.SetAccountTypeDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "setAccountType", null);
__decorate([
    (0, common_1.Delete)('accounts/type'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.ResetAccountTypeDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "resetAccountType", null);
__decorate([
    (0, common_1.Put)('accounts/currency'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.SetAccountCurrencyDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "setAccountCurrency", null);
__decorate([
    (0, common_1.Delete)('accounts/currency'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.ResetAccountTypeDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "resetAccountCurrency", null);
__decorate([
    (0, common_1.Get)('currency'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "currency", null);
__decorate([
    (0, common_1.Put)('currency'),
    __param(0, (0, book_scope_guard_1.Book)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, agency_dto_1.SetCurrencyDto]),
    __metadata("design:returntype", Promise)
], BookkeepingController.prototype, "setCurrency", null);
exports.BookkeepingController = BookkeepingController = __decorate([
    (0, common_1.Controller)('bookkeeping'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard, book_scope_guard_1.BookScopeGuard),
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
        fx_service_1.FxService,
        prisma_service_1.PrismaService,
        communications_service_1.CommunicationsService])
], BookkeepingController);
//# sourceMappingURL=bookkeeping.controller.js.map