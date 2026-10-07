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
var BookkeepingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookkeepingService = void 0;
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const openai_client_1 = require("../ai/openai.client");
const prisma_service_1 = require("../prisma/prisma.service");
const object_storage_service_1 = require("../storage/object-storage.service");
const statement_processor_service_1 = require("./statement-processor.service");
const day = (d) => d ? d.toISOString().slice(0, 10) : null;
function toView(s) {
    return {
        id: s.id,
        filename: s.filename,
        sizeBytes: s.sizeBytes,
        status: s.status,
        error: s.error,
        accountName: s.accountName,
        periodStart: day(s.periodStart),
        periodEnd: day(s.periodEnd),
        transactionCount: s.transactionCount,
        createdAt: s.createdAt,
        processedAt: s.processedAt,
    };
}
let BookkeepingService = BookkeepingService_1 = class BookkeepingService {
    prisma;
    storage;
    openai;
    processor;
    logger = new common_1.Logger(BookkeepingService_1.name);
    constructor(prisma, storage, openai, processor) {
        this.prisma = prisma;
        this.storage = storage;
        this.openai = openai;
        this.processor = processor;
    }
    async upload(customerId, files) {
        try {
            if (!files?.length)
                throw new common_1.BadRequestException('Choose at least one PDF statement');
            if (!this.storage.configured || !this.openai.configured) {
                throw new common_1.ServiceUnavailableException('Statement uploads are not available right now. Please try again later.');
            }
            const created = [];
            for (const file of files) {
                const key = `bookkeeping/${customerId}/${(0, crypto_1.randomUUID)()}.pdf`;
                await this.storage.putFile(key, file.path, 'application/pdf');
                const row = await this.prisma.bankStatement.create({
                    data: {
                        customerId,
                        filename: file.originalname.slice(0, 191),
                        storageKey: key,
                        sizeBytes: file.size,
                    },
                });
                created.push(toView(row));
            }
            this.processor.processSoon();
            return created;
        }
        finally {
            await Promise.all((files ?? []).map((f) => (0, promises_1.unlink)(f.path).catch(() => undefined)));
        }
    }
    async list(customerId) {
        const rows = await this.prisma.bankStatement.findMany({
            where: { customerId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(toView);
    }
    async transactions(customerId, statementIds) {
        const rows = await this.prisma.bankTransaction.findMany({
            where: {
                customerId,
                ...(statementIds?.length && { statementId: { in: statementIds } }),
                statement: { deletedAt: null, status: client_1.StatementStatus.DONE },
            },
            orderBy: [
                { postingDate: 'desc' },
                { statementId: 'desc' },
                { position: 'desc' },
            ],
        });
        return rows.map((r) => ({
            id: r.id,
            statementId: r.statementId,
            pendingDate: day(r.pendingDate),
            postingDate: day(r.postingDate),
            description: r.description,
            amount: Number(r.amount),
            offsetAccount: r.offsetAccount,
            debitAccount: r.debitAccount,
            creditAccount: r.creditAccount,
        }));
    }
    async file(customerId, id) {
        const s = await this.owned(customerId, id);
        const info = await this.storage.head(s.storageKey);
        if (!info)
            throw new common_1.NotFoundException('The original file is no longer available');
        return {
            stream: await this.storage.getStream(s.storageKey),
            filename: s.filename,
            size: info.size,
        };
    }
    async retry(customerId, id) {
        const s = await this.owned(customerId, id);
        if (s.status !== client_1.StatementStatus.FAILED) {
            throw new common_1.BadRequestException('Only a statement that failed can be retried');
        }
        const row = await this.prisma.bankStatement.update({
            where: { id: s.id },
            data: { status: client_1.StatementStatus.PENDING, attempts: 0, error: null },
        });
        this.processor.processSoon();
        return toView(row);
    }
    async remove(customerId, id) {
        const s = await this.owned(customerId, id);
        await this.prisma.bankStatement.update({
            where: { id: s.id },
            data: { deletedAt: new Date() },
        });
    }
    async owned(customerId, id) {
        const s = await this.prisma.bankStatement.findFirst({
            where: { id, customerId, deletedAt: null },
        });
        if (!s)
            throw new common_1.NotFoundException('Statement not found');
        return s;
    }
};
exports.BookkeepingService = BookkeepingService;
exports.BookkeepingService = BookkeepingService = BookkeepingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        object_storage_service_1.ObjectStorageService,
        openai_client_1.OpenAiClient,
        statement_processor_service_1.StatementProcessorService])
], BookkeepingService);
//# sourceMappingURL=bookkeeping.service.js.map