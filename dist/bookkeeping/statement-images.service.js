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
        try {
            const images = await (0, pdf_images_1.itemImages)(pdf, pages);
            const label = (0, statement_label_1.statementLabel)(statement);
            const refs = [];
            for (const image of images) {
                const sourceRef = (0, attachment_match_util_1.statementImageRef)(statement.id, image.page, image.index);
                refs.push(sourceRef);
                const existing = await this.prisma.transactionAttachment.findUnique({
                    where: { sourceRef },
                    select: { storageKey: true },
                });
                const storageKey = existing?.storageKey ??
                    `bookkeeping/${statement.customerId}/attachments/${(0, crypto_1.randomUUID)()}.png`;
                await this.storage.putBuffer(storageKey, image.png, 'image/png');
                const queued = {
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
                        customerId: statement.customerId,
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
                    customerId: statement.customerId,
                    sourceRef: { startsWith: `stmt:${statement.id}:`, notIn: refs },
                    deletedAt: null,
                },
                data: { deletedAt: new Date() },
            });
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
    async removeFor(customerId, statementId) {
        await this.prisma.transactionAttachment.updateMany({
            where: {
                customerId,
                sourceRef: { startsWith: `stmt:${statementId}:` },
                deletedAt: null,
            },
            data: { deletedAt: new Date() },
        });
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