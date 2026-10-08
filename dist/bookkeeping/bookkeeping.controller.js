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
const bookkeeping_service_1 = require("./bookkeeping.service");
const chart_of_accounts_1 = require("./chart-of-accounts");
const reports_query_dto_1 = require("./dto/reports-query.dto");
const export_service_1 = require("./export.service");
const reports_service_1 = require("./reports.service");
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
    constructor(bookkeeping, exporter, customers, reportsService) {
        this.bookkeeping = bookkeeping;
        this.exporter = exporter;
        this.customers = customers;
        this.reportsService = reportsService;
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
    accounts() {
        return chart_of_accounts_1.CHART_OF_ACCOUNTS;
    }
};
exports.BookkeepingController = BookkeepingController;
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
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Array)
], BookkeepingController.prototype, "accounts", null);
exports.BookkeepingController = BookkeepingController = __decorate([
    (0, common_1.Controller)('bookkeeping'),
    (0, common_1.UseGuards)(customer_jwt_guard_1.CustomerJwtGuard),
    __metadata("design:paramtypes", [bookkeeping_service_1.BookkeepingService,
        export_service_1.LedgerExportService,
        customer_auth_service_1.CustomerAuthService,
        reports_service_1.ReportsService])
], BookkeepingController);
//# sourceMappingURL=bookkeeping.controller.js.map