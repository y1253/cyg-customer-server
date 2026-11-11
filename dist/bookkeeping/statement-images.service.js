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
var StatementImagesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatementImagesService = exports.STATEMENT_SOURCE = void 0;
const crypto_1 = require("crypto");
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const object_storage_service_1 = require("../storage/object-storage.service");
const attachment_match_util_1 = require("./attachment-match.util");
const attachment_processor_service_1 = require("./attachment-processor.service");
const pdf_images_1 = require("./pdf-images");
const scope_1 = require("./scope");
const statement_label_1 = require("./statement-label");
exports.STATEMENT_SOURCE = 'STATEMENT';
let StatementImagesService = StatementImagesService_1 = class StatementImagesService {
    prisma;
    storage;
    attachments;
    logger = new common_1.Logger(StatementImagesService_1.name);
    constructor(prisma, storage, attachments) {
        this.prisma = prisma;
        this.storage = storage;
        this.attachments = attachments;
    }
    async harvest(statement, pdf, pages) {
        const scope = (0, scope_1.scopeOf)(statement);
        try {
            const images = await (0, pdf_images_1.itemImages)(pdf, pages);
            const label = (0, statement_label_1.statementLabel)(statement);
            const refs = [];
            for (const image of images) {
                const sourceRef = (0, attachment_match_util_1.statementImageRef)(statement.id, image.page, image.index);
                refs.push(sourceRef);
                const existing = await this.prisma.transactionAttachment.findUnique({
                    where: { sourceRef },
                    select: { storageKey: true, sourceStorageKey: true },
                });
                const storageKey = existing?.sourceStorageKey ??
                    existing?.storageKey ??
                    `${(0, scope_1.storagePrefix)(scope)}/attachments/${(0, crypto_1.randomUUID)()}.png`;
                await this.storage.putBuffer(storageKey, image.png, 'image/png');
                if (existing?.sourceStorageKey && existing.storageKey !== storageKey) {
                    await this.storage.delete(existing.storageKey).catch(() => undefined);
                }
                const queued = {
                    storageKey,
                    sourceStorageKey: null,
                    mimeType: 'image/png',
                    status: client_1.AttachmentStatus.PENDING,
                    transactionId: null,
                    extracted: client_1.Prisma.DbNull,
                    matchNote: null,
                    error: null,
                    attempts: 0,
                    nextAttemptAt: null,
                    deletedAt: null,
                    size: image.png.length,
                };
                await this.prisma.transactionAttachment.upsert({
                    where: { sourceRef },
                    create: {
                        ...queued,
                        ...(0, scope_1.scopeWhere)(scope),
                        filename: `${label} p${image.page + 1} #${image.index + 1}.png`.slice(0, 255),
                        mimeType: 'image/png',
                        storageKey,
                        source: exports.STATEMENT_SOURCE,
                        sourceRef,
                    },
                    update: queued,
                });
            }
            await this.prisma.transactionAttachment.updateMany({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    sourceRef: { startsWith: `stmt:${statement.id}:`, notIn: refs },
                    deletedAt: null,
                },
                data: { deletedAt: new Date() },
            });
            await this.dropSiblingsOfDeleted(scope);
            if (images.length)
                this.attachments.processSoon();
            if (pages.length) {
                this.logger.log(`statement #${statement.id}: ${images.length} item image(s) from ${pages.length} page(s)`);
            }
        }
        catch (err) {
            this.logger.warn(`statement #${statement.id}: item images not attached: ${String(err)}`);
        }
    }
    async removeFor(scope, statementId) {
        await this.prisma.transactionAttachment.updateMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                sourceRef: { startsWith: `stmt:${statementId}:` },
                deletedAt: null,
            },
            data: { deletedAt: new Date() },
        });
        await this.dropSiblingsOfDeleted(scope);
    }
    async dropSiblingsOfDeleted(scope) {
        const alive = await this.prisma.transactionAttachment.findMany({
            where: {
                ...(scope ? (0, scope_1.scopeWhere)(scope) : {}),
                source: 'STATEMENT',
                sourceRef: { startsWith: 'doc:' },
                deletedAt: null,
            },
            select: { id: true, sourceRef: true, transactionId: true },
        });
        if (!alive.length)
            return 0;
        const parentOf = (ref) => Number(ref?.split(':')[1]);
        const parents = await this.prisma.transactionAttachment.findMany({
            where: {
                id: { in: [...new Set(alive.map((a) => parentOf(a.sourceRef)))] },
            },
            select: { id: true, deletedAt: true },
        });
        const dead = new Set(parents.filter((p) => p.deletedAt).map((p) => p.id));
        const orphans = alive.filter((a) => dead.has(parentOf(a.sourceRef)));
        if (!orphans.length)
            return 0;
        const txIds = orphans
            .map((o) => o.transactionId)
            .filter((t) => !!t);
        const liveTx = new Set((await this.prisma.bankTransaction.findMany({
            where: { id: { in: txIds }, statement: { deletedAt: null } },
            select: { id: true },
        })).map((t) => t.id));
        const drop = orphans
            .filter((o) => !o.transactionId || !liveTx.has(o.transactionId))
            .map((o) => o.id);
        if (!drop.length)
            return 0;
        await this.prisma.transactionAttachment.updateMany({
            where: { id: { in: drop } },
            data: { deletedAt: new Date() },
        });
        this.logger.log(`${drop.length} cut document(s) of deleted statement images removed`);
        return drop.length + (await this.dropSiblingsOfDeleted(scope));
    }
    onApplicationBootstrap() {
        setTimeout(() => {
            void this.dropSiblingsOfDeleted().catch((err) => this.logger.warn(`orphan crop sweep failed: ${String(err)}`));
        }, 75_000).unref?.();
    }
};
exports.StatementImagesService = StatementImagesService;
exports.StatementImagesService = StatementImagesService = StatementImagesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        object_storage_service_1.ObjectStorageService,
        attachment_processor_service_1.AttachmentProcessorService])
], StatementImagesService);
//# sourceMappingURL=statement-images.service.js.map