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
const pricing_1 = require("../billing/pricing");
const prisma_service_1 = require("../prisma/prisma.service");
const object_storage_service_1 = require("../storage/object-storage.service");
const opening_balance_query_1 = require("./opening-balance.query");
const opening_balance_util_1 = require("./opening-balance.util");
const statement_label_1 = require("./statement-label");
const statement_processor_service_1 = require("./statement-processor.service");
const statement_images_service_1 = require("./statement-images.service");
const tax_service_1 = require("./tax.service");
const scope_1 = require("./scope");
const splits_util_1 = require("./splits.util");
const fx_service_1 = require("./fx.service");
const tax_util_1 = require("./tax.util");
const day = (d) => d ? d.toISOString().slice(0, 10) : null;
function withFx(views, ctx, statements) {
    const entries = [];
    const out = views.map((v) => {
        if (!ctx.isForeign(v.statementId))
            return v;
        const { home, rate } = ctx.convert(v.statementId, v.postingDate ?? v.pendingDate, v.amount);
        entries.push({
            statementId: v.statementId,
            bankAccount: v.amount < 0 ? v.creditAccount : v.debitAccount,
            amount: v.amount,
            home,
        });
        return {
            ...v,
            currency: ctx.currencyOf(v.statementId),
            fxRate: rate,
            homeAmount: home,
        };
    });
    const revalued = new Map(ctx.revaluations(entries).map((r) => [r.statementId, r]));
    return out.flatMap((v, i) => {
        const r = revalued.get(v.statementId);
        if (!r || out.findIndex((x) => x.statementId === v.statementId) !== i) {
            return [v];
        }
        const s = statements.get(r.statementId);
        return [
            {
                key: `f:${r.statementId}`,
                id: 0,
                statementId: r.statementId,
                pendingDate: null,
                postingDate: r.date,
                description: `Exchange rate on ${r.date}: ${r.rate.toFixed(4)}`,
                name: null,
                amount: 0,
                offsetAccount: r.offsetAccount,
                debitAccount: r.debitAccount,
                creditAccount: r.creditAccount,
                statementLabel: s ? (0, statement_label_1.statementLabel)(s) : '',
                kind: 'fx',
                currency: ctx.currencyOf(r.statementId),
                fxRate: r.rate,
                homeAmount: r.homeAmount,
            },
            v,
        ];
    });
}
function withTaxLines(p, lines) {
    if (!lines?.length)
        return [p];
    const split = (0, tax_util_1.taxSplit)(p, lines);
    return [
        split.parent,
        ...split.taxes.map((entry, i) => ({
            ...p,
            ...entry,
            key: `x:${p.id}:${lines[i].agencyId}`,
            attachments: undefined,
            name: lines[i].name ?? p.name,
            kind: 'tax',
            taxRate: lines[i].rate,
            taxAgencyId: lines[i].agencyId,
        })),
    ];
}
function toView(s, currencies = new Map()) {
    return {
        id: s.id,
        filename: s.filename,
        sizeBytes: s.sizeBytes,
        status: s.status,
        error: s.error,
        accountName: s.accountName,
        accountKind: s.accountKind,
        currency: s.currency,
        accountCurrency: (0, opening_balance_query_1.effectiveCurrency)(s, currencies),
        bankName: s.bankName,
        label: (0, statement_label_1.statementLabel)(s),
        periodStart: day(s.periodStart),
        periodEnd: day(s.periodEnd),
        transactionCount: s.transactionCount,
        createdAt: s.createdAt,
        processedAt: s.processedAt,
        movedByCustomer: s.accountNameByCustomer !== null,
    };
}
let BookkeepingService = BookkeepingService_1 = class BookkeepingService {
    prisma;
    storage;
    openai;
    processor;
    tax;
    images;
    fx;
    logger = new common_1.Logger(BookkeepingService_1.name);
    constructor(prisma, storage, openai, processor, tax, images, fx) {
        this.prisma = prisma;
        this.storage = storage;
        this.openai = openai;
        this.processor = processor;
        this.tax = tax;
        this.images = images;
        this.fx = fx;
    }
    async upload(scope, files) {
        try {
            if (!files?.length)
                throw new common_1.BadRequestException('Choose at least one PDF statement');
            if (!this.storage.configured || !this.openai.configured) {
                throw new common_1.ServiceUnavailableException('Statement uploads are not available right now. Please try again later.');
            }
            const created = [];
            for (const file of files) {
                const key = `${(0, scope_1.storagePrefix)(scope)}/${(0, crypto_1.randomUUID)()}.pdf`;
                await this.storage.putFile(key, file.path, 'application/pdf');
                const row = await this.prisma.bankStatement.create({
                    data: {
                        ...(0, scope_1.scopeWhere)(scope),
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
    async generateIfFree(scope) {
        const waiting = await this.waitingCount(scope);
        if (waiting && (await (0, pricing_1.readPricing)(this.prisma)).generatePriceCents > 0)
            throw new common_1.HttpException('Payment required — pay to read your new statements.', common_1.HttpStatus.PAYMENT_REQUIRED);
        return this.generate(scope);
    }
    waitingCount(scope) {
        return this.prisma.bankStatement.count({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                deletedAt: null,
                status: client_1.StatementStatus.UPLOADED,
            },
        });
    }
    async generate(scope) {
        const { count } = await this.prisma.bankStatement.updateMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                deletedAt: null,
                status: client_1.StatementStatus.UPLOADED,
            },
            data: { status: client_1.StatementStatus.PENDING },
        });
        if (count)
            this.processor.processSoon();
        return { queued: count, taxing: false };
    }
    async list(scope) {
        const [rows, currencies, opening] = await Promise.all([
            this.prisma.bankStatement.findMany({
                where: { ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
                orderBy: { createdAt: 'desc' },
            }),
            (0, opening_balance_query_1.accountCurrencies)(this.prisma, scope),
            (0, opening_balance_query_1.loadOpeningStatements)(this.prisma, scope),
        ]);
        const starts = new Map([...(0, opening_balance_util_1.startsByAccount)((0, opening_balance_util_1.openingRows)(opening)).values()]
            .flat()
            .map((s) => [s.statementId, { date: s.date, amount: s.amount }]));
        return rows.map((r) => ({
            ...toView(r, currencies),
            startingBalance: starts.get(r.id) ?? null,
        }));
    }
    async transactions(scope, statementIds) {
        const [rows, statements, taxes, attached] = await Promise.all([
            this.prisma.bankTransaction.findMany({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
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
            (0, opening_balance_query_1.loadOpeningStatements)(this.prisma, scope),
            this.tax.linesFor(scope, statementIds),
            this.prisma.transactionAttachment.findMany({
                where: {
                    ...(0, scope_1.scopeWhere)(scope),
                    deletedAt: null,
                    transactionId: { not: null },
                },
                select: { id: true, kind: true, filename: true, transactionId: true },
                orderBy: { id: 'asc' },
            }),
        ]);
        const attachmentsOf = new Map();
        for (const a of attached) {
            const list = attachmentsOf.get(a.transactionId) ?? [];
            list.push({ id: a.id, kind: a.kind, filename: a.filename });
            attachmentsOf.set(a.transactionId, list);
        }
        const byId = new Map(statements.map((s) => [s.id, s]));
        const totals = (0, splits_util_1.splitTotals)(rows.map((r) => ({ splitOfId: r.splitOfId, amount: Number(r.amount) })));
        const viewOf = (r) => ({
            key: r.splitOfId ? `s:${r.id}` : `t:${r.id}`,
            id: r.id,
            statementId: r.statementId,
            pendingDate: day(r.pendingDate),
            postingDate: day(r.postingDate),
            description: r.description,
            name: r.name,
            ...(r.itemName && { itemName: r.itemName }),
            amount: (0, splits_util_1.remainderOf)({ ...r, amount: Number(r.amount) }, totals),
            offsetAccount: r.offsetAccount,
            debitAccount: r.debitAccount,
            creditAccount: r.creditAccount,
            statementLabel: (0, statement_label_1.statementLabel)(r.statement),
            ...(r.splitOfId && { splitOfId: r.splitOfId, kind: 'split' }),
            ...(attachmentsOf.has(r.id) && { attachments: attachmentsOf.get(r.id) }),
        });
        const splitsOf = new Map();
        for (const r of rows) {
            if (!r.splitOfId)
                continue;
            const list = splitsOf.get(r.splitOfId) ?? [];
            list.push(viewOf(r));
            splitsOf.set(r.splitOfId, list);
        }
        for (const list of splitsOf.values())
            list.sort((a, b) => a.id - b.id);
        const wanted = statementIds?.length ? new Set(statementIds) : null;
        const openings = (0, opening_balance_util_1.openingRows)(statements).filter((o) => !wanted || wanted.has(o.statementId));
        const keyed = [
            ...rows
                .filter((r) => !r.splitOfId)
                .map((r) => ({
                postingDate: r.postingDate,
                statementId: r.statementId,
                position: r.position,
                view: viewOf(r),
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
        const views = sorted.flatMap((p) => p.kind
            ? [p]
            : [
                ...withTaxLines(p, taxes.get(p.id)),
                ...(splitsOf.get(p.id) ?? []).flatMap((c) => withTaxLines(c, taxes.get(c.id))),
            ]);
        const ctx = await this.fx.context(scope, statements);
        return ctx.anyForeign ? withFx(views, ctx, byId) : views;
    }
    async file(scope, id) {
        const s = await this.owned(scope, id);
        const info = await this.storage.head(s.storageKey);
        if (!info)
            throw new common_1.NotFoundException('The original file is no longer available');
        return {
            stream: await this.storage.getStream(s.storageKey),
            filename: s.filename,
            size: info.size,
        };
    }
    async retry(scope, id) {
        const s = await this.owned(scope, id);
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
    async remove(scope, id) {
        const s = await this.owned(scope, id);
        await this.prisma.bankStatement.update({
            where: { id: s.id },
            data: { deletedAt: new Date() },
        });
        await this.images.removeFor(scope, s.id);
    }
    async moveStatement(scope, id, rawName) {
        const s = await this.owned(scope, id);
        if (s.status !== client_1.StatementStatus.DONE &&
            s.status !== client_1.StatementStatus.NEEDS_REVIEW) {
            throw new common_1.BadRequestException('Only a statement that has been read can be moved');
        }
        const name = rawName.trim().replace(/\s+/g, ' ');
        if (!name || name.length > 191) {
            throw new common_1.BadRequestException('Enter an account name');
        }
        const old = s.accountName;
        if (name === old)
            return toView(s);
        const target = await this.prisma.bankStatement.findFirst({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                accountName: name,
                deletedAt: null,
                id: { not: s.id },
            },
            select: { accountKind: true },
        });
        const row = await this.prisma.$transaction(async (tx) => {
            await tx.bankTransaction.updateMany({
                where: { statementId: s.id, amount: { lt: 0 } },
                data: { creditAccount: name },
            });
            await tx.bankTransaction.updateMany({
                where: { statementId: s.id, amount: { gte: 0 } },
                data: { debitAccount: name },
            });
            const updated = await tx.bankStatement.update({
                where: { id: s.id },
                data: {
                    accountName: name,
                    accountNameByCustomer: name,
                    accountKind: target ? target.accountKind : s.accountKind,
                },
            });
            if (old) {
                const left = await tx.bankStatement.count({
                    where: { ...(0, scope_1.scopeWhere)(scope), accountName: old, deletedAt: null },
                });
                if (left === 0) {
                    const kept = await tx.customerAccountType.findFirst({
                        where: { ...(0, scope_1.scopeWhere)(scope), account: name },
                    });
                    if (kept) {
                        await tx.customerAccountType.deleteMany({
                            where: { ...(0, scope_1.scopeWhere)(scope), account: old },
                        });
                    }
                    else {
                        await tx.customerAccountType.updateMany({
                            where: { ...(0, scope_1.scopeWhere)(scope), account: old },
                            data: { account: name },
                        });
                    }
                    const keptCurrency = await tx.customerAccountCurrency.findFirst({
                        where: { ...(0, scope_1.scopeWhere)(scope), account: name },
                    });
                    if (keptCurrency) {
                        await tx.customerAccountCurrency.deleteMany({
                            where: { ...(0, scope_1.scopeWhere)(scope), account: old },
                        });
                    }
                    else {
                        await tx.customerAccountCurrency.updateMany({
                            where: { ...(0, scope_1.scopeWhere)(scope), account: old },
                            data: { account: name },
                        });
                    }
                }
            }
            return updated;
        });
        this.logger.log(`${(0, scope_1.bookLabel)(scope)}: statement #${s.id} moved "${old}" -> "${name}"`);
        return toView(row);
    }
    async owned(scope, id) {
        const s = await this.prisma.bankStatement.findFirst({
            where: { id, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
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
        tax_service_1.TaxService,
        statement_images_service_1.StatementImagesService,
        fx_service_1.FxService])
], BookkeepingService);
//# sourceMappingURL=bookkeeping.service.js.map