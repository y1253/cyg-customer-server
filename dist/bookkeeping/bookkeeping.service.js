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
const opening_balance_query_1 = require("./opening-balance.query");
const opening_balance_util_1 = require("./opening-balance.util");
const statement_label_1 = require("./statement-label");
const statement_processor_service_1 = require("./statement-processor.service");
const tax_service_1 = require("./tax.service");
const tax_util_1 = require("./tax.util");
const day = (d) => d ? d.toISOString().slice(0, 10) : null;
function toView(s) {
    return {
        id: s.id,
        filename: s.filename,
        sizeBytes: s.sizeBytes,
        status: s.status,
        error: s.error,
        accountName: s.accountName,
        bankName: s.bankName,
        label: (0, statement_label_1.statementLabel)(s),
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
    tax;
    logger = new common_1.Logger(BookkeepingService_1.name);
    constructor(prisma, storage, openai, processor, tax) {
        this.prisma = prisma;
        this.storage = storage;
        this.openai = openai;
        this.processor = processor;
        this.tax = tax;
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
            return created;
        }
        finally {
            await Promise.all((files ?? []).map((f) => (0, promises_1.unlink)(f.path).catch(() => undefined)));
        }
    }
    async generate(customerId) {
        const { count } = await this.prisma.bankStatement.updateMany({
            where: { customerId, deletedAt: null, status: client_1.StatementStatus.UPLOADED },
            data: { status: client_1.StatementStatus.PENDING },
        });
        if (count)
            this.processor.processSoon();
        const taxing = (await this.tax.needsRetag(customerId)) &&
            (await this.tax.retagCustomer(customerId));
        return { queued: count, taxing };
    }
    async list(customerId) {
        const rows = await this.prisma.bankStatement.findMany({
            where: { customerId, deletedAt: null },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(toView);
    }
    async transactions(customerId, statementIds) {
        const [rows, statements, taxes] = await Promise.all([
            this.prisma.bankTransaction.findMany({
                where: {
                    customerId,
                    ...(statementIds?.length && { statementId: { in: statementIds } }),
                    statement: { deletedAt: null, status: client_1.StatementStatus.DONE },
                },
                include: {
                    statement: {
                        select: {
                            accountName: true,
                            bankName: true,
                            filename: true,
                            periodStart: true,
                            periodEnd: true,
                        },
                    },
                },
            }),
            (0, opening_balance_query_1.loadOpeningStatements)(this.prisma, customerId),
            this.tax.linesFor(customerId, statementIds),
        ]);
        const byId = new Map(statements.map((s) => [s.id, s]));
        const wanted = statementIds?.length ? new Set(statementIds) : null;
        const openings = (0, opening_balance_util_1.openingRows)(statements).filter((o) => !wanted || wanted.has(o.statementId));
        const keyed = [
            ...rows.map((r) => ({
                postingDate: r.postingDate,
                statementId: r.statementId,
                position: r.position,
                view: {
                    key: `t:${r.id}`,
                    id: r.id,
                    statementId: r.statementId,
                    pendingDate: day(r.pendingDate),
                    postingDate: day(r.postingDate),
                    description: r.description,
                    name: r.name,
                    amount: Number(r.amount),
                    offsetAccount: r.offsetAccount,
                    debitAccount: r.debitAccount,
                    creditAccount: r.creditAccount,
                    statementLabel: (0, statement_label_1.statementLabel)(r.statement),
                },
            })),
            ...openings.map((o) => ({
                postingDate: o.postingDate,
                statementId: o.statementId,
                position: opening_balance_util_1.OPENING_POSITION,
                view: {
                    key: `o:${o.statementId}`,
                    id: 0,
                    statementId: o.statementId,
                    pendingDate: null,
                    postingDate: day(o.postingDate),
                    description: o.description,
                    name: null,
                    amount: o.amount,
                    offsetAccount: o.offsetAccount,
                    debitAccount: o.debitAccount,
                    creditAccount: o.creditAccount,
                    statementLabel: (0, statement_label_1.statementLabel)(byId.get(o.statementId)),
                    kind: 'opening',
                },
            })),
        ];
        const sorted = keyed.sort((a, b) => -(0, opening_balance_util_1.ledgerOrder)(a, b)).map((k) => k.view);
        return sorted.flatMap((p) => {
            const lines = p.kind ? undefined : taxes.get(p.id);
            if (!lines?.length)
                return [p];
            const split = (0, tax_util_1.taxSplit)(p, lines);
            return [
                split.parent,
                ...split.taxes.map((entry, i) => ({
                    ...p,
                    ...entry,
                    key: `x:${lines[i].id}`,
                    kind: 'tax',
                    taxRate: lines[i].rate,
                })),
            ];
        });
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
        if (s.status !== client_1.StatementStatus.FAILED &&
            s.status !== client_1.StatementStatus.NEEDS_REVIEW) {
            throw new common_1.BadRequestException('Only a statement that failed can be retried');
        }
        const row = await this.prisma.bankStatement.update({
            where: { id: s.id },
            data: {
                status: client_1.StatementStatus.PENDING,
                attempts: 0,
                runs: 0,
                error: null,
            },
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
        statement_processor_service_1.StatementProcessorService,
        tax_service_1.TaxService])
], BookkeepingService);
//# sourceMappingURL=bookkeeping.service.js.map