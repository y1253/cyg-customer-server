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
exports.FileLinkController = exports.FileLinkService = exports.FILE_LINK_TTL_DAYS = exports.FILE_LINK_TOKEN_TYPE = void 0;
exports.linkProblemPage = linkProblemPage;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const prisma_service_1 = require("../prisma/prisma.service");
const attachments_service_1 = require("./attachments.service");
const bookkeeping_service_1 = require("./bookkeeping.service");
const export_service_1 = require("./export.service");
const report_pdf_1 = require("./report-pdf");
const reports_service_1 = require("./reports.service");
const books_1 = require("./books");
exports.FILE_LINK_TOKEN_TYPE = 'file-link';
exports.FILE_LINK_TTL_DAYS = 7;
function contentDisposition(filename) {
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
let FileLinkService = class FileLinkService {
    config;
    prisma;
    bookkeeping;
    attachments;
    reports;
    exporter;
    jwt;
    constructor(config, prisma, bookkeeping, attachments, reports, exporter) {
        this.config = config;
        this.prisma = prisma;
        this.bookkeeping = bookkeeping;
        this.attachments = attachments;
        this.reports = reports;
        this.exporter = exporter;
        this.jwt = new jwt_1.JwtService({
            secret: config.getOrThrow('CUSTOMER_JWT_SECRET'),
        });
    }
    base() {
        return (this.config.get('PUBLIC_BASE_URL')?.trim().replace(/\/+$/, '') ||
            'https://cygfinance.com');
    }
    async link(scope, target) {
        if (target.kind === 'statement') {
            await this.bookkeeping.fileInfo(scope, target.id ?? 0);
        }
        else if (target.kind === 'attachment') {
            await this.attachments.get(scope, target.id ?? 0);
        }
        const claims = {
            typ: exports.FILE_LINK_TOKEN_TYPE,
            sub: scope.customerId,
            b: scope.bookId,
            k: target.kind,
            ...(target.id ? { i: target.id } : {}),
            ...(target.from ? { f: target.from } : {}),
            ...(target.to ? { t: target.to } : {}),
            ...(target.format ? { x: target.format } : {}),
        };
        const token = this.jwt.sign(claims, {
            expiresIn: `${exports.FILE_LINK_TTL_DAYS}d`,
        });
        return `${this.base()}/api/f/${token}`;
    }
    async open(token) {
        let p;
        try {
            p = this.jwt.verify(token);
        }
        catch {
            throw new common_1.NotFoundException('This link has expired. Ask for a new one.');
        }
        if (p.typ !== exports.FILE_LINK_TOKEN_TYPE || typeof p.sub !== 'number') {
            throw new common_1.NotFoundException('This link is not valid');
        }
        const scope = await this.liveScope(p.sub, {
            bookId: p.b ?? null,
            companyId: p.c ?? null,
        });
        switch (p.k) {
            case 'statement': {
                const f = await this.bookkeeping.file(scope, p.i ?? 0);
                return {
                    body: new common_1.StreamableFile(f.stream),
                    filename: f.filename,
                    mimeType: 'application/pdf',
                };
            }
            case 'attachment': {
                const f = await this.attachments.file(scope, p.i ?? 0);
                return {
                    body: new common_1.StreamableFile(f.stream),
                    filename: f.filename,
                    mimeType: f.mimeType,
                };
            }
            case 'report': {
                const view = await this.reports.reports(scope, p.f ?? null, p.t ?? null);
                const buf = await (0, report_pdf_1.reportPdf)(view, await this.ownerName(scope));
                return {
                    body: new common_1.StreamableFile(buf),
                    filename: `financial-report${p.t ? `-${p.t}` : ''}.pdf`,
                    mimeType: 'application/pdf',
                };
            }
            case 'ledger': {
                const rows = await this.exporter.rowsFor(scope);
                const owner = await this.ownerName(scope);
                const xlsx = p.x === 'xlsx';
                const buf = xlsx
                    ? await this.exporter.excel(rows, owner)
                    : await this.exporter.pdf(rows, owner);
                return {
                    body: new common_1.StreamableFile(buf),
                    filename: `ledger-${new Date().toISOString().slice(0, 10)}.${xlsx ? 'xlsx' : 'pdf'}`,
                    mimeType: xlsx
                        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                        : 'application/pdf',
                };
            }
        }
        throw new common_1.NotFoundException('This link is not valid');
    }
    async liveScope(customerId, ref) {
        const customer = await this.prisma.customer.findFirst({
            where: { id: customerId, deletedAt: null },
            select: { id: true },
        });
        if (!customer)
            throw new common_1.NotFoundException('This link is not valid');
        try {
            return await (0, books_1.legacyBook)(this.prisma, customerId, ref);
        }
        catch {
            throw new common_1.NotFoundException('This link is not valid');
        }
    }
    async ownerName(scope) {
        return (0, books_1.bookOwnerName)(this.prisma, scope);
    }
};
exports.FileLinkService = FileLinkService;
exports.FileLinkService = FileLinkService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService,
        bookkeeping_service_1.BookkeepingService,
        attachments_service_1.AttachmentsService,
        reports_service_1.ReportsService,
        export_service_1.LedgerExportService])
], FileLinkService);
function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
function linkProblemPage(reason) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Link not available · CYG Finance</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2937">
<h1 style="font-size:1.25rem">This link can't be opened</h1>
<p>${escapeHtml(reason)}</p>
<p>Links to your files work for 7 days. Ask the CYG Finance assistant for a new one, or sign in at <a href="https://cygfinance.com/login">cygfinance.com</a>.</p>
</body></html>`;
}
let FileLinkController = class FileLinkController {
    links;
    constructor(links) {
        this.links = links;
    }
    async open(token, res) {
        let f;
        try {
            f = await this.links.open(token);
        }
        catch (err) {
            if (!(err instanceof common_1.NotFoundException))
                throw err;
            res.status(404).set({
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'private, no-store',
                'X-Robots-Tag': 'noindex',
            });
            return linkProblemPage(err.message);
        }
        res.set({
            'Content-Type': f.mimeType,
            'Content-Disposition': contentDisposition(f.filename),
            'Cache-Control': 'private, no-store',
            'X-Robots-Tag': 'noindex',
        });
        return f.body;
    }
};
exports.FileLinkController = FileLinkController;
__decorate([
    (0, common_1.Get)(':token'),
    __param(0, (0, common_1.Param)('token')),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FileLinkController.prototype, "open", null);
exports.FileLinkController = FileLinkController = __decorate([
    (0, common_1.Controller)('f'),
    __metadata("design:paramtypes", [FileLinkService])
], FileLinkController);
//# sourceMappingURL=file-links.js.map