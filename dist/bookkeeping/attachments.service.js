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
exports.AttachmentsService = void 0;
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const openai_client_1 = require("../ai/openai.client");
const prisma_service_1 = require("../prisma/prisma.service");
const object_storage_service_1 = require("../storage/object-storage.service");
const attachment_processor_service_1 = require("./attachment-processor.service");
const attachment_folders_util_1 = require("./attachment-folders.util");
const attachment_uploads_1 = require("./attachment-uploads");
const scope_1 = require("./scope");
const statement_label_1 = require("./statement-label");
const INCLUDE = {
    transaction: {
        include: {
            statement: {
                select: {
                    accountName: true,
                    accountNameByCustomer: true,
                    bankName: true,
                    filename: true,
                    periodStart: true,
                    periodEnd: true,
                    deletedAt: true,
                    status: true,
                },
            },
            _count: { select: { splits: true } },
        },
    },
};
const day = (d) => d ? d.toISOString().slice(0, 10) : null;
function toView(a) {
    const reading = a.extracted ?? null;
    const t = a.transaction;
    const live = t && !t.statement.deletedAt && t.statement.status === client_1.StatementStatus.DONE;
    return {
        id: a.id,
        kind: a.kind,
        status: a.status,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        createdAt: a.createdAt,
        reading,
        total: reading ? (0, attachment_processor_service_1.readingTotal)(reading) : null,
        matchNote: a.matchNote,
        error: a.error,
        source: a.source,
        sourcePhone: a.sourcePhone,
        message: a.message,
        folder: (0, attachment_folders_util_1.attachmentFolder)(live ? t : null),
        transaction: live
            ? {
                id: t.id,
                name: t.name,
                description: t.description,
                amount: Number(t.amount),
                date: day(t.postingDate ?? t.pendingDate),
                statementId: t.statementId,
                statementLabel: (0, statement_label_1.statementLabel)(t.statement),
                splitCount: t._count.splits,
            }
            : null,
    };
}
let AttachmentsService = class AttachmentsService {
    prisma;
    storage;
    openai;
    processor;
    constructor(prisma, storage, openai, processor) {
        this.prisma = prisma;
        this.storage = storage;
        this.openai = openai;
        this.processor = processor;
    }
    async upload(scope, files, transactionId) {
        try {
            if (!files?.length)
                throw new common_1.BadRequestException('Choose a file to add');
            if (!this.storage.configured || !this.openai.configured) {
                throw new common_1.ServiceUnavailableException('Attachments are not available right now. Please try again later.');
            }
            if (transactionId != null)
                await this.parent(scope, transactionId);
            const ids = [];
            for (const file of files) {
                const type = (0, attachment_uploads_1.attachmentType)(file.originalname);
                if (!type)
                    continue;
                const key = `${(0, scope_1.storagePrefix)(scope)}/attachments/${(0, crypto_1.randomUUID)()}${type.ext}`;
                await this.storage.putFile(key, file.path, type.mime);
                const row = await this.prisma.transactionAttachment.create({
                    data: {
                        ...(0, scope_1.scopeWhere)(scope),
                        transactionId,
                        kind: type.cls === 'audio'
                            ? client_1.AttachmentKind.AUDIO
                            : client_1.AttachmentKind.OTHER,
                        filename: file.originalname.slice(0, 255),
                        mimeType: type.mime,
                        size: file.size,
                        storageKey: key,
                    },
                    select: { id: true },
                });
                ids.push(row.id);
            }
            this.processor.processSoon();
            const rows = await this.prisma.transactionAttachment.findMany({
                where: { id: { in: ids } },
                include: INCLUDE,
                orderBy: { id: 'desc' },
            });
            return rows.map(toView);
        }
        finally {
            await Promise.all((files ?? []).map((f) => (0, promises_1.unlink)(f.path).catch(() => undefined)));
        }
    }
    async intake(scope) {
        const [numbers, me] = await Promise.all([
            this.prisma.intakeNumber.findMany({
                where: { releasedAt: null },
                orderBy: { createdAt: 'asc' },
                select: { phoneNumber: true, whatsappStatus: true },
            }),
            this.prisma.customer.findUnique({
                where: { id: scope.customerId },
                select: { phone: true, phoneE164: true },
            }),
        ]);
        return {
            numbers: numbers.map((n) => n.phoneNumber),
            whatsapp: numbers
                .filter((n) => n.whatsappStatus === 'CONNECTED')
                .map((n) => n.phoneNumber),
            phone: me?.phoneE164 ?? null,
            phoneSaved: !!me?.phone,
        };
    }
    async list(scope) {
        const rows = await this.prisma.transactionAttachment.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            include: INCLUDE,
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(toView);
    }
    async get(scope, id) {
        return toView(await this.owned(scope, id));
    }
    async setTransaction(scope, id, transactionId) {
        const a = await this.owned(scope, id);
        if (a.status === client_1.AttachmentStatus.PENDING ||
            a.status === client_1.AttachmentStatus.PROCESSING) {
            throw new common_1.BadRequestException('This file is still being read. Try again in a moment.');
        }
        if (transactionId == null) {
            await this.prisma.transactionAttachment.update({
                where: { id: a.id },
                data: {
                    transactionId: null,
                    status: client_1.AttachmentStatus.UNMATCHED,
                    matchNote: 'Removed from its transaction by you.',
                },
            });
            return this.get(scope, id);
        }
        await this.parent(scope, transactionId);
        await this.prisma.transactionAttachment.update({
            where: { id: a.id },
            data: {
                transactionId,
                status: a.extracted ? client_1.AttachmentStatus.MATCHED : a.status,
                matchNote: 'Attached by you.',
            },
        });
        if (a.extracted) {
            const note = await this.processor.applyItems(scope, a.id, false);
            if (note) {
                await this.prisma.transactionAttachment.update({
                    where: { id: a.id },
                    data: { matchNote: `Attached by you. ${note}`.slice(0, 512) },
                });
            }
        }
        return this.get(scope, id);
    }
    async applyItems(scope, id) {
        const a = await this.owned(scope, id);
        if (!a.transactionId) {
            throw new common_1.BadRequestException('Attach the receipt to a transaction first');
        }
        const note = await this.processor.applyItems(scope, a.id, true);
        if (note)
            throw new common_1.BadRequestException(note);
        return this.get(scope, id);
    }
    async retry(scope, id) {
        const a = await this.owned(scope, id);
        if (a.status !== client_1.AttachmentStatus.FAILED &&
            a.status !== client_1.AttachmentStatus.UNMATCHED) {
            throw new common_1.BadRequestException('Only a file that failed or found no match can be read again');
        }
        await this.prisma.transactionAttachment.update({
            where: { id: a.id },
            data: { status: client_1.AttachmentStatus.PENDING, attempts: 0, error: null },
        });
        this.processor.processSoon();
        return this.get(scope, id);
    }
    async remove(scope, id) {
        const a = await this.owned(scope, id);
        await this.prisma.transactionAttachment.update({
            where: { id: a.id },
            data: { deletedAt: new Date() },
        });
    }
    async file(scope, id) {
        const a = await this.owned(scope, id);
        const info = await this.storage.head(a.storageKey);
        if (!info)
            throw new common_1.NotFoundException('The file is no longer available');
        return {
            stream: await this.storage.getStream(a.storageKey),
            filename: a.filename,
            mimeType: a.mimeType,
            size: info.size,
        };
    }
    async byTransaction(scope, transactionIds) {
        const out = new Map();
        if (!transactionIds.length)
            return out;
        const rows = await this.prisma.transactionAttachment.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                deletedAt: null,
                transactionId: { in: transactionIds },
            },
            select: { id: true, kind: true, filename: true, transactionId: true },
            orderBy: { id: 'asc' },
        });
        for (const r of rows) {
            const list = out.get(r.transactionId) ?? [];
            list.push({ id: r.id, kind: r.kind, filename: r.filename });
            out.set(r.transactionId, list);
        }
        return out;
    }
    async owned(scope, id) {
        const a = await this.prisma.transactionAttachment.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            include: INCLUDE,
        });
        if (!a)
            throw new common_1.NotFoundException('Attachment not found');
        return a;
    }
    async parent(scope, id) {
        const t = await this.prisma.bankTransaction.findFirst({
            where: {
                id,
                ...(0, scope_1.scopeWhere)(scope),
                statement: { deletedAt: null, status: client_1.StatementStatus.DONE },
            },
            select: { splitOfId: true },
        });
        if (!t)
            throw new common_1.NotFoundException('Transaction not found');
        if (t.splitOfId) {
            throw new common_1.BadRequestException('Add the file to the transaction this split came from.');
        }
    }
};
exports.AttachmentsService = AttachmentsService;
exports.AttachmentsService = AttachmentsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        object_storage_service_1.ObjectStorageService,
        openai_client_1.OpenAiClient,
        attachment_processor_service_1.AttachmentProcessorService])
], AttachmentsService);
//# sourceMappingURL=attachments.service.js.map