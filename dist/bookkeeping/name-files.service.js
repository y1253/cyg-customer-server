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
var NameFilesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NameFilesService = exports.CUSTOMER_SYSTEM_TOKEN_TYPE = exports.PHONE_UPLOAD_TOKEN_TYPE = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const prisma_service_1 = require("../prisma/prisma.service");
const attachment_name_util_1 = require("./attachment-name.util");
const attachments_service_1 = require("./attachments.service");
const scope_1 = require("./scope");
exports.PHONE_UPLOAD_TOKEN_TYPE = 'phone-upload';
exports.CUSTOMER_SYSTEM_TOKEN_TYPE = 'customer-system';
const PHONE_UPLOAD_TTL = '30m';
const WELCOME_EVERY_MS = 10 * 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let NameFilesService = NameFilesService_1 = class NameFilesService {
    prisma;
    config;
    logger = new common_1.Logger(NameFilesService_1.name);
    jwt;
    welcomeSent = new Map();
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
        this.jwt = new jwt_1.JwtService({
            secret: config.getOrThrow('CUSTOMER_JWT_SECRET'),
        });
    }
    async folders(scope) {
        const rows = await this.prisma.nameFolder.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            orderBy: [{ title: 'asc' }, { id: 'asc' }],
            select: { id: true, name: true, parentId: true, title: true },
        });
        return rows.map((r) => ({
            id: r.id,
            nameKey: r.name,
            parentId: r.parentId,
            title: r.title,
        }));
    }
    async createFolder(scope, name, parentId, rawTitle) {
        const title = cleanTitle(rawTitle);
        const key = name ? (0, attachment_name_util_1.nameKeyOf)(name) : '';
        if (parentId != null) {
            const parent = await this.folder(scope, parentId);
            if (parent.name !== key)
                throw new common_1.BadRequestException('That folder is under another name');
        }
        await this.prisma.nameFolder.create({
            data: { ...(0, scope_1.scopeWhere)(scope), name: key, parentId, title },
        });
        return this.folders(scope);
    }
    async renameFolder(scope, id, rawTitle) {
        const f = await this.folder(scope, id);
        await this.prisma.nameFolder.update({
            where: { id: f.id },
            data: { title: cleanTitle(rawTitle) },
        });
        return this.folders(scope);
    }
    async removeFolder(scope, id) {
        const f = await this.folder(scope, id);
        await this.prisma.$transaction([
            this.prisma.transactionAttachment.updateMany({
                where: { ...(0, scope_1.scopeWhere)(scope), folderId: f.id },
                data: { folderId: f.parentId },
            }),
            this.prisma.nameFolder.updateMany({
                where: { ...(0, scope_1.scopeWhere)(scope), parentId: f.id, deletedAt: null },
                data: { parentId: f.parentId },
            }),
            this.prisma.nameFolder.update({
                where: { id: f.id },
                data: { deletedAt: new Date() },
            }),
        ]);
        return this.folders(scope);
    }
    async folder(scope, id) {
        const f = await this.prisma.nameFolder.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
        });
        if (!f)
            throw new common_1.NotFoundException('Folder not found');
        return f;
    }
    async email(scope, id) {
        const a = await this.prisma.transactionAttachment.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            select: {
                id: true,
                filename: true,
                mimeType: true,
                source: true,
                sourcePhone: true,
                message: true,
                createdAt: true,
                inboxMessageId: true,
                inboxMessage: {
                    select: {
                        fromEmail: true,
                        toEmail: true,
                        subject: true,
                        receivedAt: true,
                        bodyText: true,
                        bodyHtml: true,
                    },
                },
            },
        });
        if (!a)
            throw new common_1.NotFoundException('Attachment not found');
        const m = a.inboxMessage;
        if (!m) {
            if (a.source !== 'EMAIL')
                throw new common_1.NotFoundException('This file did not come by email');
            return {
                from: a.sourcePhone,
                to: null,
                subject: null,
                receivedAt: a.createdAt,
                text: a.message,
                html: null,
                partial: true,
                files: [{ id: a.id, filename: a.filename, mimeType: a.mimeType }],
            };
        }
        const files = await this.prisma.transactionAttachment.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                deletedAt: null,
                inboxMessageId: a.inboxMessageId,
            },
            select: { id: true, filename: true, mimeType: true },
            orderBy: { id: 'asc' },
        });
        return {
            from: m.fromEmail,
            to: m.toEmail,
            subject: m.subject,
            receivedAt: m.receivedAt,
            text: m.bodyText ?? a.message,
            html: m.bodyHtml,
            partial: m.bodyText == null && m.bodyHtml == null,
            files,
        };
    }
    async phoneUploadLink(scope, place) {
        const name = (0, attachments_service_1.cleanName)(place.name);
        if (place.folderId != null)
            await this.folder(scope, place.folderId);
        const claims = {
            typ: exports.PHONE_UPLOAD_TOKEN_TYPE,
            sub: scope.customerId,
            bookId: scope.bookId,
            ...(name ? { name } : {}),
            ...(place.folderId != null ? { folderId: place.folderId } : {}),
        };
        const token = this.jwt.sign(claims, { expiresIn: PHONE_UPLOAD_TTL });
        const base = (this.config.get('PUBLIC_BASE_URL') ?? 'https://cygfinance.com').replace(/\/+$/, '');
        return { url: `${base}/upload/${token}`, expiresInMinutes: 30 };
    }
    async phoneUploadTarget(token) {
        let c;
        try {
            c = this.jwt.verify(token);
        }
        catch {
            throw new common_1.UnauthorizedException('This link has expired. Scan the QR code again on your computer.');
        }
        if (c.typ !== exports.PHONE_UPLOAD_TOKEN_TYPE || !c.sub || !c.bookId)
            throw new common_1.UnauthorizedException('This link is not valid.');
        const book = await this.prisma.book.findFirst({
            where: {
                id: c.bookId,
                customerId: c.sub,
                deletedAt: null,
                customer: { deletedAt: null },
            },
            select: { id: true, customerId: true, companyId: true, name: true },
        });
        if (!book)
            throw new common_1.UnauthorizedException('This link is not valid.');
        return {
            scope: (0, scope_1.bookScope)(book),
            name: c.name ?? null,
            folderId: c.folderId ?? null,
            bookName: book.name,
        };
    }
    async welcomeEmail(scope, rawTo) {
        const to = rawTo.trim().toLowerCase();
        if (!EMAIL_RE.test(to) || to.length > 191)
            throw new common_1.BadRequestException('Type a valid email address');
        const last = this.welcomeSent.get(scope.customerId) ?? 0;
        if (Date.now() - last < WELCOME_EVERY_MS)
            throw new common_1.HttpException('We just sent a welcome email — give it a few minutes.', common_1.HttpStatus.TOO_MANY_REQUESTS);
        const [customer, book] = await Promise.all([
            this.prisma.customer.findFirst({
                where: { id: scope.customerId, deletedAt: null },
                select: { name: true, email: true },
            }),
            this.prisma.book.findUnique({
                where: { id: scope.bookId },
                select: { name: true },
            }),
        ]);
        if (!customer)
            throw new common_1.NotFoundException();
        if (to !== customer.email?.toLowerCase()) {
            const known = await this.prisma.customerSenderEmail.findFirst({
                where: { customerId: scope.customerId, email: to },
                select: { id: true },
            });
            if (!known)
                await this.prisma.customerSenderEmail.create({
                    data: { customerId: scope.customerId, email: to },
                });
        }
        const base = (this.config.get('INTERNAL_API_URL') ?? 'http://localhost:3000/api').replace(/\/+$/, '');
        const token = this.jwt.sign({ typ: exports.CUSTOMER_SYSTEM_TOKEN_TYPE }, { expiresIn: '2m' });
        try {
            const res = await fetch(`${base}/customer-inbox/welcome`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    to,
                    customerName: customer.name,
                    bookName: book?.name ?? null,
                }),
                signal: AbortSignal.timeout(20_000),
            });
            const body = (await res.json().catch(() => null));
            if (!res.ok) {
                this.logger.warn(`welcome email for customer ${scope.customerId}: internal API answered ${res.status} ${body?.message ?? ''}`);
                return {
                    ok: false,
                    message: res.status === 503
                        ? 'Our email inbox is not connected right now — please try again later.'
                        : 'We could not send the email right now — please try again later.',
                };
            }
            this.welcomeSent.set(scope.customerId, Date.now());
            return {
                ok: true,
                message: `Sent to ${to}${body?.from ? ` from ${body.from}` : ''}.`,
            };
        }
        catch (err) {
            this.logger.warn(`welcome email for customer ${scope.customerId}: internal API unreachable: ${err instanceof Error ? err.message : String(err)}`);
            return {
                ok: false,
                message: 'We could not send the email right now — please try again later.',
            };
        }
    }
};
exports.NameFilesService = NameFilesService;
exports.NameFilesService = NameFilesService = NameFilesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], NameFilesService);
function cleanTitle(raw) {
    const t = raw?.replace(/\s+/g, ' ').trim().slice(0, 128);
    if (!t)
        throw new common_1.BadRequestException('Give the folder a name');
    return t;
}
//# sourceMappingURL=name-files.service.js.map