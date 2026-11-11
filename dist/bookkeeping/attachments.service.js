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
exports.AttachmentsService = exports.cleanName = exports.NOT_VOICE_MESSAGE = void 0;
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_1 = require("@prisma/client");
const stream_1 = require("stream");
const openai_client_1 = require("../ai/openai.client");
const reach_1 = require("../messaging/reach");
const prisma_service_1 = require("../prisma/prisma.service");
const object_storage_service_1 = require("../storage/object-storage.service");
const attachment_processor_service_1 = require("./attachment-processor.service");
const attachment_folders_util_1 = require("./attachment-folders.util");
const attachment_name_util_1 = require("./attachment-name.util");
const attachment_uploads_1 = require("./attachment-uploads");
const scope_1 = require("./scope");
const statement_label_1 = require("./statement-label");
const cheque_caption_util_1 = require("./cheque-caption.util");
const attachment_match_util_1 = require("./attachment-match.util");
exports.NOT_VOICE_MESSAGE = {
    NOT: { kind: client_1.AttachmentKind.AUDIO, status: client_1.AttachmentStatus.DOCUMENT },
};
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
const cleanName = (s) => s?.replace(/\s+/g, ' ').trim().slice(0, 191) || null;
exports.cleanName = cleanName;
const day = (d) => d ? d.toISOString().slice(0, 10) : null;
function withSourceStatements(views, rows) {
    const refOf = new Map(rows.map((r) => [r.id, r.sourceRef]));
    return views.map((v) => {
        if (v.fromStatementId !== null)
            return v;
        let ref = refOf.get(v.id) ?? null;
        for (let i = 0; i < 3 && ref?.startsWith('doc:'); i++) {
            ref = refOf.get(Number(ref.split(':')[1])) ?? null;
        }
        const id = (0, attachment_match_util_1.statementOf)(ref);
        return id === null ? v : { ...v, fromStatementId: id };
    });
}
function toView(a, messageCount = 0) {
    const reading = a.extracted ?? null;
    const t = a.transaction;
    const live = t && !t.statement.deletedAt && t.statement.status === client_1.StatementStatus.DONE;
    return {
        id: a.id,
        fromStatementId: (0, attachment_match_util_1.statementOf)(a.sourceRef),
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
        messageCount,
        cropped: !!a.sourceStorageKey,
        siblings: [],
        ...placeOf(a, reading, live ? t : null),
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
function placeOf(a, reading, t) {
    const name = (0, attachment_name_util_1.attachmentName)({
        nameOverride: a.nameOverride,
        transaction: t,
        reading,
    });
    return {
        name,
        bucket: (0, attachment_name_util_1.fileBucket)(a.status, !!t, name == null),
        folderId: a.folderId,
        displayName: a.displayName,
        hasEmail: a.inboxMessageId != null || a.source === 'EMAIL',
    };
}
let AttachmentsService = class AttachmentsService {
    prisma;
    storage;
    openai;
    processor;
    config;
    constructor(prisma, storage, openai, processor, config) {
        this.prisma = prisma;
        this.storage = storage;
        this.openai = openai;
        this.processor = processor;
        this.config = config;
    }
    async upload(scope, files, transactionId, place = {}) {
        try {
            if (!files?.length)
                throw new common_1.BadRequestException('Choose a file to add');
            if (!this.storage.configured || !this.openai.configured) {
                throw new common_1.ServiceUnavailableException('Attachments are not available right now. Please try again later.');
            }
            if (transactionId != null)
                await this.parent(scope, transactionId);
            const folderId = place.folderId != null
                ? (await this.folder(scope, place.folderId)).id
                : null;
            const nameOverride = (0, exports.cleanName)(place.name);
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
                        nameOverride,
                        folderId,
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
            return rows.map((r) => toView(r));
        }
        finally {
            await Promise.all((files ?? []).map((f) => (0, promises_1.unlink)(f.path).catch(() => undefined)));
        }
    }
    async intake(scope) {
        const [reach, me] = await Promise.all([
            this.config ? (0, reach_1.firmReach)(this.prisma, this.config) : Promise.resolve(null),
            this.prisma.customer.findUnique({
                where: { id: scope.customerId },
                select: { phone: true, phoneE164: true },
            }),
        ]);
        return {
            numbers: reach?.numbers ?? [],
            whatsapp: reach?.whatsapp ?? [],
            phone: me?.phoneE164 ?? null,
            phoneSaved: !!me?.phone,
            email: reach?.email ?? null,
            voice: reach?.voice ?? false,
        };
    }
    async list(scope) {
        const rows = await this.prisma.transactionAttachment.findMany({
            where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null, ...exports.NOT_VOICE_MESSAGE },
            include: INCLUDE,
            orderBy: { createdAt: 'desc' },
        });
        const counts = await this.messageCounts(scope, rows.map((r) => r.id));
        return withSourceStatements(rows.map((r) => toView(r, counts.get(r.id) ?? 0)), rows);
    }
    async get(scope, id) {
        const row = await this.owned(scope, id);
        const counts = await this.messageCounts(scope, [row.id]);
        const group = await this.groupOf(scope, row);
        const [view] = withSourceStatements([toView(row, counts.get(row.id) ?? 0)], group);
        return {
            ...view,
            siblings: group.filter((x) => x.id !== row.id).map((x) => x.id),
        };
    }
    async groupOf(scope, row) {
        const rootId = (0, attachment_processor_service_1.siblingOf)(row.sourceRef)?.rowId ?? row.id;
        return this.prisma.transactionAttachment.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                deletedAt: null,
                OR: [{ id: rootId }, { sourceRef: { startsWith: `doc:${rootId}:` } }],
            },
            select: { id: true, transactionId: true, sourceRef: true },
            orderBy: { id: 'asc' },
        });
    }
    async reread(scope, id, note) {
        const a = await this.owned(scope, id);
        if (a.status === client_1.AttachmentStatus.PENDING ||
            a.status === client_1.AttachmentStatus.PROCESSING) {
            throw new common_1.BadRequestException('This file is being read right now');
        }
        const group = await this.groupOf(scope, a);
        const rootId = (0, attachment_processor_service_1.siblingOf)(a.sourceRef)?.rowId ?? a.id;
        const root = group.find((x) => x.id === rootId) ?? { id: a.id };
        const text = note?.trim().slice(0, 1000) || null;
        await this.prisma.$transaction([
            this.prisma.transactionAttachment.updateMany({
                where: {
                    id: { in: group.map((x) => x.id).filter((x) => x !== root.id) },
                },
                data: {
                    transactionId: null,
                    status: client_1.AttachmentStatus.UNMATCHED,
                    matchNote: 'Being read again.',
                },
            }),
            this.prisma.transactionAttachment.update({
                where: { id: root.id },
                data: {
                    transactionId: null,
                    status: client_1.AttachmentStatus.PENDING,
                    attempts: 0,
                    error: null,
                    ...(text && {
                        extracted: {
                            ...((await this.readingOf(root.id)) ?? {}),
                            customerNote: text,
                        },
                    }),
                },
            }),
        ]);
        this.processor.processSoon();
        return this.get(scope, root.id);
    }
    async readingOf(id) {
        const row = await this.prisma.transactionAttachment.findUnique({
            where: { id },
            select: { extracted: true },
        });
        const e = row?.extracted;
        return e && typeof e === 'object' && !Array.isArray(e)
            ? e
            : null;
    }
    async messageCounts(scope, ids) {
        const out = new Map();
        if (!ids.length)
            return out;
        try {
            const rows = await this.prisma.aiMessageAttachment.groupBy({
                by: ['attachmentId'],
                where: { ...(0, scope_1.scopeWhere)(scope), attachmentId: { in: ids } },
                _count: { _all: true },
            });
            for (const r of rows)
                out.set(r.attachmentId, r._count._all);
        }
        catch {
        }
        return out;
    }
    async chequeKeptOn(scope, id, transactionId) {
        const row = await this.prisma.transactionAttachment.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            select: {
                transactionId: true,
                extracted: true,
                transaction: { select: { description: true } },
            },
        });
        if (!row?.transaction || row.transactionId === transactionId)
            return null;
        const e = (row.extracted ?? {});
        const wanted = typeof e.checkNumber === 'string'
            ? e.checkNumber.replace(/\D/g, '').replace(/^0+/, '')
            : '';
        if (!wanted || (0, cheque_caption_util_1.chequeNumberOf)(row.transaction.description) !== wanted) {
            return null;
        }
        const target = await this.prisma.bankTransaction.findFirst({
            where: { id: transactionId, ...(0, scope_1.scopeWhere)(scope) },
            select: { description: true },
        });
        if (target && (0, cheque_caption_util_1.chequeNumberOf)(target.description) === wanted)
            return null;
        return `Not moved: this is cheque ${e.checkNumber} and it is already on "${row.transaction.description}", the transaction printing that number. Tell the customer; move it only if they say it is wrong (customerSaysWrong=true).`;
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
            a.status !== client_1.AttachmentStatus.UNMATCHED &&
            a.status !== client_1.AttachmentStatus.DOCUMENT) {
            throw new common_1.BadRequestException('Only a file that failed or found no match can be read again');
        }
        await this.prisma.transactionAttachment.update({
            where: { id: a.id },
            data: { status: client_1.AttachmentStatus.PENDING, attempts: 0, error: null },
        });
        this.processor.processSoon();
        return this.get(scope, id);
    }
    async place(scope, id, p) {
        const a = await this.owned(scope, id);
        const data = {};
        if (p.name !== undefined) {
            data.nameOverride = (0, exports.cleanName)(p.name);
            if (p.folderId === undefined)
                data.folderId = null;
        }
        if (p.folderId !== undefined) {
            data.folderId =
                p.folderId == null ? null : (await this.folder(scope, p.folderId)).id;
        }
        if (p.displayName !== undefined) {
            data.displayName = p.displayName?.trim().slice(0, 255) || null;
        }
        await this.prisma.transactionAttachment.update({
            where: { id: a.id },
            data,
        });
        return this.get(scope, id);
    }
    async folder(scope, id) {
        const f = await this.prisma.nameFolder.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            select: { id: true },
        });
        if (!f)
            throw new common_1.NotFoundException('Folder not found');
        return f;
    }
    async remove(scope, id) {
        const a = await this.owned(scope, id);
        await this.prisma.transactionAttachment.update({
            where: { id: a.id },
            data: { deletedAt: new Date() },
        });
    }
    async file(scope, id, original = false) {
        const a = await this.owned(scope, id);
        const key = (original && a.sourceStorageKey) || a.storageKey;
        const info = await this.storage.head(key);
        if (!info)
            throw new common_1.NotFoundException('The file is no longer available');
        if (key !== a.storageKey) {
            const head = await this.storage.getBuffer(key);
            return {
                stream: stream_1.Readable.from(head),
                filename: `whole image - ${a.filename}`,
                mimeType: (0, attachment_processor_service_1.sniffImageMime)(head) ?? 'application/octet-stream',
                size: head.length,
            };
        }
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
    __param(4, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        object_storage_service_1.ObjectStorageService,
        openai_client_1.OpenAiClient,
        attachment_processor_service_1.AttachmentProcessorService,
        config_1.ConfigService])
], AttachmentsService);
//# sourceMappingURL=attachments.service.js.map