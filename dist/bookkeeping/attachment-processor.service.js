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
var AttachmentProcessorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttachmentProcessorService = exports.siblingRef = void 0;
exports.siblingName = siblingName;
exports.readingTotal = readingTotal;
exports.siblingOf = siblingOf;
exports.kindFor = kindFor;
exports.classOf = classOf;
const ai_usage_context_1 = require("../ai/ai-usage.context");
const common_1 = require("@nestjs/common");
const rules_service_1 = require("../assistant/rules.service");
const schedule_1 = require("@nestjs/schedule");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const object_storage_service_1 = require("../storage/object-storage.service");
const attachment_extractor_1 = require("./attachment-extractor");
const attachment_match_util_1 = require("./attachment-match.util");
const name_memory_service_1 = require("./name-memory.service");
const name_memory_util_1 = require("./name-memory.util");
const product_memory_service_1 = require("./product-memory.service");
const receipt_items_util_1 = require("./receipt-items.util");
const reconcile_util_1 = require("./reconcile.util");
const splits_service_1 = require("./splits.service");
const queue_retry_1 = require("./queue-retry");
const scope_1 = require("./scope");
const CONCURRENCY = 2;
const GENERIC_CHEQUE_NAME = /^(cheque|check|chq|chk)\b/i;
const BATCH = 6;
const STALE_PROCESSING_MS = 10 * 60_000;
const day = (d) => d ? d.toISOString().slice(0, 10) : null;
function siblingName(filename, n, total) {
    return `${filename.slice(0, 230)} (${n + 1} of ${total})`;
}
function readingTotal(r) {
    if (r.total)
        return r.total;
    if (r.subtotal)
        return ((0, reconcile_util_1.cents)(r.subtotal) + (0, reconcile_util_1.cents)(r.tax ?? 0)) / 100;
    const items = r.items.reduce((n, i) => n + (0, reconcile_util_1.cents)(i.amount), 0);
    return items > 0 ? (items + (0, reconcile_util_1.cents)(r.tax ?? 0)) / 100 : null;
}
const siblingRef = (rowId, n) => `doc:${rowId}:${n}`;
exports.siblingRef = siblingRef;
function siblingOf(sourceRef) {
    const m = /^doc:(\d+):(\d+)$/.exec(sourceRef ?? '');
    return m ? { rowId: Number(m[1]), index: Number(m[2]) } : null;
}
function kindFor(cls, reading) {
    if (cls === 'audio')
        return client_1.AttachmentKind.AUDIO;
    if (cls === 'text')
        return client_1.AttachmentKind.TEXT;
    switch (reading.documentType) {
        case 'INVOICE':
            return client_1.AttachmentKind.INVOICE;
        case 'CHECK':
            return client_1.AttachmentKind.CHECK;
        case 'DEPOSIT_SLIP':
            return client_1.AttachmentKind.DEPOSIT_SLIP;
        case 'DOCUMENT':
            return client_1.AttachmentKind.DOCUMENT;
        case 'BANK_STATEMENT':
            return client_1.AttachmentKind.OTHER;
        case 'RECEIPT':
        case 'PAYMENT_NOTE':
            return client_1.AttachmentKind.RECEIPT;
        default:
            return client_1.AttachmentKind[reading.kind];
    }
}
function classOf(mimeType) {
    if (mimeType.startsWith('audio/'))
        return 'audio';
    if (mimeType.startsWith('text/plain'))
        return 'text';
    if (mimeType === 'application/pdf')
        return 'pdf';
    return 'image';
}
let AttachmentProcessorService = AttachmentProcessorService_1 = class AttachmentProcessorService {
    prisma;
    storage;
    extractor;
    splits;
    products;
    names;
    rules;
    logger = new common_1.Logger(AttachmentProcessorService_1.name);
    sweeping = false;
    constructor(prisma, storage, extractor, splits, products, names, rules) {
        this.prisma = prisma;
        this.storage = storage;
        this.extractor = extractor;
        this.splits = splits;
        this.products = products;
        this.names = names;
        this.rules = rules;
    }
    processSoon() {
        void this.sweep().catch(() => undefined);
    }
    async sweep() {
        if (this.sweeping)
            return;
        this.sweeping = true;
        try {
            await this.runSweep();
        }
        catch (err) {
            this.logger.error(`sweep failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            this.sweeping = false;
        }
    }
    async runSweep() {
        const now = Date.now();
        const candidates = await this.prisma.transactionAttachment.findMany({
            where: {
                deletedAt: null,
                OR: [
                    { status: client_1.AttachmentStatus.PENDING },
                    {
                        status: client_1.AttachmentStatus.PROCESSING,
                        updatedAt: { lt: new Date(now - STALE_PROCESSING_MS) },
                    },
                ],
            },
            orderBy: { updatedAt: 'asc' },
            take: BATCH * 4,
        });
        const due = candidates
            .filter((a) => a.status === client_1.AttachmentStatus.PROCESSING ||
            (0, queue_retry_1.claimableAt)(a.updatedAt, a.attempts) <= now)
            .slice(0, BATCH);
        if (!due.length)
            return;
        let next = 0;
        const worker = async () => {
            while (next < due.length) {
                const row = due[next++];
                await (0, ai_usage_context_1.withAiUsage)({ ...(0, scope_1.scopeOf)(row), feature: 'ATTACHMENT' }, () => this.processOne(row));
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
        if (due.length === BATCH)
            setTimeout(() => this.processSoon(), 0);
    }
    async processOne(row) {
        const claimed = await this.prisma.transactionAttachment.updateMany({
            where: {
                id: row.id,
                status: row.status,
                updatedAt: row.updatedAt,
                deletedAt: null,
            },
            data: { status: client_1.AttachmentStatus.PROCESSING, error: null },
        });
        if (claimed.count === 0)
            return;
        const scope = (0, scope_1.scopeOf)(row);
        try {
            const cls = classOf(row.mimeType);
            const file = await this.storage.getBuffer(row.storageKey);
            const readings = await this.extractor.read(file, row.filename, row.mimeType, cls, day(row.createdAt), row.message, (await this.rules?.promptBlock(scope, undefined, 'ATTACHMENT_READER')) ?? '');
            const sibling = siblingOf(row.sourceRef);
            if (sibling) {
                const reading = readings[sibling.index] ?? readings[0];
                const parent = await this.prisma.transactionAttachment.findUnique({
                    where: { id: sibling.rowId },
                    select: { sourceRef: true },
                });
                await this.finish(row, scope, cls, reading, (0, attachment_match_util_1.statementOf)(parent?.sourceRef));
                return;
            }
            await this.finish(row, scope, cls, readings[0], (0, attachment_match_util_1.statementOf)(row.sourceRef));
            await this.fileSiblings(row, scope, cls, readings);
        }
        catch (err) {
            await this.recordFailure(row, err);
        }
    }
    async finish(row, scope, cls, reading, statementId) {
        const kind = kindFor(cls, reading);
        let transactionId = row.transactionId;
        let note;
        let status;
        if (transactionId) {
            note = 'Added from the transaction.';
            status = client_1.AttachmentStatus.MATCHED;
        }
        else if (reading.documentType === 'BANK_STATEMENT') {
            note =
                row.mimeType === 'application/pdf'
                    ? 'This looks like a bank statement, not a receipt. Ask the assistant to file it as a statement, or upload it on the Statements tab.'
                    : 'This looks like a bank statement. Upload it as a PDF on the Statements tab so its transactions are read.';
            status = client_1.AttachmentStatus.UNMATCHED;
        }
        else if (!(0, attachment_extractor_1.isPaymentDocument)(reading.documentType)) {
            note =
                reading.summary || 'Not a receipt or a payment — kept as a document.';
            status = client_1.AttachmentStatus.DOCUMENT;
        }
        else {
            const found = await this.match(scope, reading, row.message, statementId);
            transactionId = found.transactionId;
            note = found.note;
            status = transactionId
                ? client_1.AttachmentStatus.MATCHED
                : client_1.AttachmentStatus.UNMATCHED;
        }
        await this.prisma.transactionAttachment.update({
            where: { id: row.id },
            data: {
                kind,
                extracted: reading,
                transactionId,
                status,
                matchNote: note.slice(0, 512),
                error: null,
            },
        });
        if (transactionId && kind === client_1.AttachmentKind.CHECK) {
            await this.nameFromCheque(scope, transactionId, reading).catch((err) => this.logger.warn(`attachment #${row.id}: payee not applied: ${err instanceof Error ? err.message : String(err)}`));
        }
        if (transactionId) {
            const itemsNote = await this.applyItems(scope, row.id, false).catch((err) => `The items could not be split: ${err instanceof Error ? err.message : String(err)}`);
            if (itemsNote) {
                await this.prisma.transactionAttachment.update({
                    where: { id: row.id },
                    data: { matchNote: `${note} ${itemsNote}`.slice(0, 512) },
                });
            }
        }
        this.logger.log(`attachment #${row.id}${scope.companyId ? ` (company #${scope.companyId})` : ''} (${kind}) ${status === client_1.AttachmentStatus.MATCHED ? `matched #${transactionId}` : status.toLowerCase()}`);
    }
    async fileSiblings(row, scope, cls, readings) {
        const existing = await this.prisma.transactionAttachment.findMany({
            where: { sourceRef: { startsWith: `doc:${row.id}:` } },
        });
        const byRef = new Map(existing.map((x) => [x.sourceRef, x]));
        const wanted = new Set();
        for (let n = 1; n < readings.length; n++) {
            const ref = (0, exports.siblingRef)(row.id, n);
            wanted.add(ref);
            const had = byRef.get(ref);
            if (had?.deletedAt)
                continue;
            const sib = had ??
                (await this.prisma.transactionAttachment.create({
                    data: {
                        customerId: row.customerId,
                        companyId: row.companyId,
                        kind: row.kind,
                        status: client_1.AttachmentStatus.PROCESSING,
                        filename: siblingName(row.filename, n, readings.length),
                        mimeType: row.mimeType,
                        size: row.size,
                        storageKey: row.storageKey,
                        source: row.source,
                        sourcePhone: row.sourcePhone,
                        sourceRef: ref,
                        message: row.message,
                    },
                }));
            if (had && had.transactionId && had.status === client_1.AttachmentStatus.MATCHED) {
                continue;
            }
            await this.finish({ ...sib, transactionId: had?.transactionId ?? null }, scope, cls, readings[n], (0, attachment_match_util_1.statementOf)(row.sourceRef)).catch((err) => this.recordFailure(sib, err));
        }
        const gone = existing.filter((x) => !wanted.has(x.sourceRef ?? '') && !x.deletedAt && !x.transactionId);
        if (gone.length) {
            await this.prisma.transactionAttachment.updateMany({
                where: { id: { in: gone.map((x) => x.id) } },
                data: { deletedAt: new Date() },
            });
        }
        if (readings.length > 1) {
            this.logger.log(`attachment #${row.id}: ${readings.length} documents in one file`);
        }
    }
    async family(ids) {
        if (!ids.length)
            return [];
        const sibs = await this.prisma.transactionAttachment.findMany({
            where: {
                OR: ids.map((id) => ({ sourceRef: { startsWith: `doc:${id}:` } })),
                deletedAt: null,
            },
            select: { id: true, sourceRef: true },
            orderBy: { id: 'asc' },
        });
        const out = [];
        for (const id of ids) {
            out.push(id);
            for (const s of sibs)
                if (siblingOf(s.sourceRef)?.rowId === id)
                    out.push(s.id);
        }
        return out;
    }
    async waitUntilRead(ids, timeoutMs = 90_000) {
        if (!ids.length)
            return true;
        this.processSoon();
        const until = Date.now() + timeoutMs;
        for (;;) {
            const busy = await this.prisma.transactionAttachment.count({
                where: {
                    id: { in: ids },
                    deletedAt: null,
                    status: {
                        in: [client_1.AttachmentStatus.PENDING, client_1.AttachmentStatus.PROCESSING],
                    },
                },
            });
            if (!busy)
                return true;
            if (Date.now() >= until)
                return false;
            await new Promise((r) => setTimeout(r, 2_000));
        }
    }
    async nameFromCheque(scope, transactionId, reading) {
        const payee = (0, name_memory_util_1.cleanName)(reading.payee);
        if (!payee)
            return;
        const tx = await this.prisma.bankTransaction.findFirst({
            where: { id: transactionId, ...(0, scope_1.scopeWhere)(scope) },
            select: { name: true },
        });
        if (!tx || (tx.name && !GENERIC_CHEQUE_NAME.test(tx.name)))
            return;
        const known = await this.names.categoryOfName(scope, payee);
        await this.names.editTransaction(scope, transactionId, {
            name: payee,
            category: known ? null : (reading.category ?? null),
            scope: 'ONCE',
        });
    }
    async recordFailure(row, err) {
        const message = err instanceof Error ? err.message : String(err);
        const attempts = row.attempts + 1;
        const final = err instanceof attachment_extractor_1.UnreadableAttachmentError || attempts >= queue_retry_1.MAX_ATTEMPTS;
        this.logger.warn(`attachment #${row.id} attempt ${attempts} failed${final ? ' (final)' : ''}: ${message}`);
        await this.prisma.transactionAttachment
            .update({
            where: { id: row.id },
            data: {
                attempts,
                status: final ? client_1.AttachmentStatus.FAILED : client_1.AttachmentStatus.PENDING,
                error: final
                    ? err instanceof attachment_extractor_1.UnreadableAttachmentError
                        ? message.slice(0, 512)
                        : 'We could not read this file. Try again, or upload a clearer copy.'
                    : null,
            },
        })
            .catch(() => undefined);
    }
    async match(scope, reading, message, statementId = null) {
        const total = readingTotal(reading);
        if (total == null && !reading.date) {
            return {
                transactionId: null,
                note: 'No amount or date could be read, so choose the transaction yourself.',
            };
        }
        const q = {
            kind: reading.kind === 'RECEIPT'
                ? 'RECEIPT'
                : reading.kind === 'CHECK'
                    ? 'CHECK'
                    : 'OTHER',
            date: reading.date,
            total,
        };
        let list = statementId
            ? (0, attachment_match_util_1.shortlist)(q, await this.candidates(scope, q, statementId))
            : [];
        if (!list.length)
            list = (0, attachment_match_util_1.shortlist)(q, await this.candidates(scope, q));
        const byNumber = (0, attachment_match_util_1.chequeNumberMatch)(reading.checkNumber, total, list);
        if (byNumber) {
            return {
                transactionId: byNumber.id,
                note: `Matched by cheque number ${reading.checkNumber} (${byNumber.name ?? byNumber.description}).`,
            };
        }
        const byAmount = statementId && q.kind === 'CHECK' ? (0, attachment_match_util_1.chequeAmountMatch)(total, list) : null;
        if (byAmount) {
            return {
                transactionId: byAmount.id,
                note: `Matched to the cheque of $${total.toFixed(2)} on this statement (${byAmount.name ?? byAmount.description}).`,
            };
        }
        if (!list.length) {
            return {
                transactionId: null,
                note: total
                    ? `No transaction of $${total.toFixed(2)} was found${reading.date ? ` around ${reading.date}` : ''}. Upload the statement first, or choose the transaction yourself.`
                    : 'No matching transaction was found. Choose it yourself.',
            };
        }
        const obvious = (0, attachment_match_util_1.obviousMatch)(q, list);
        if (obvious) {
            return {
                transactionId: obvious.id,
                note: `Matched by amount and date (${obvious.name ?? obvious.description}).`,
            };
        }
        const top = list.slice(0, attachment_match_util_1.MAX_FOR_AI);
        const pick = await this.extractor.pick(reading, top, message, (await this.rules?.promptBlock(scope, 'MATCHING', 'MATCHER')) ?? '');
        const chosen = top.find((c) => c.id === pick.transactionId);
        if (chosen && pick.confident) {
            return {
                transactionId: chosen.id,
                note: pick.reason || 'Matched by the AI.',
            };
        }
        return {
            transactionId: null,
            note: `${pick.reason ? `${pick.reason} ` : ''}Choose the transaction yourself.`,
        };
    }
    async candidatesFor(scope, attachmentId, hints = {}, limit = 30) {
        const a = await this.prisma.transactionAttachment.findFirst({
            where: { id: attachmentId, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            select: { extracted: true },
        });
        if (!a)
            return [];
        const reading = (a.extracted ??
            null);
        const amount = hints.amount ?? (reading ? readingTotal(reading) : null);
        const anchor = reading?.date ?? null;
        const dayMs = 86_400_000;
        const isDay = (d) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
        const from = isDay(hints.from)
            ? new Date(`${hints.from}T00:00:00Z`)
            : anchor
                ? new Date(Date.parse(`${anchor}T00:00:00Z`) - 45 * dayMs)
                : null;
        const to = isDay(hints.to)
            ? new Date(`${hints.to}T23:59:59Z`)
            : anchor
                ? new Date(Date.parse(`${anchor}T00:00:00Z`) + 45 * dayMs)
                : null;
        const where = {
            ...(0, scope_1.scopeWhere)(scope),
            splitOfId: null,
            statement: { deletedAt: null, status: client_1.StatementStatus.DONE },
        };
        const and = [];
        if (amount && amount > 0) {
            const lo = (amount * 0.75).toFixed(2);
            const hi = (amount * 1.25).toFixed(2);
            and.push({
                OR: [
                    { amount: { gte: lo, lte: hi } },
                    { amount: { gte: `-${hi}`, lte: `-${lo}` } },
                ],
            });
        }
        if (from || to) {
            and.push({
                OR: [
                    {
                        postingDate: { ...(from && { gte: from }), ...(to && { lte: to }) },
                    },
                    {
                        postingDate: null,
                        pendingDate: { ...(from && { gte: from }), ...(to && { lte: to }) },
                    },
                ],
            });
        }
        const text = hints.text?.trim();
        if (text) {
            and.push({
                OR: [{ name: { contains: text } }, { description: { contains: text } }],
            });
        }
        if (and.length)
            where.AND = and;
        const rows = await this.prisma.bankTransaction.findMany({
            where,
            take: 500,
            select: {
                id: true,
                postingDate: true,
                pendingDate: true,
                amount: true,
                name: true,
                description: true,
            },
        });
        const at = anchor ? Date.parse(`${anchor}T00:00:00Z`) : null;
        const gap = (d) => at === null || !d ? Number.MAX_SAFE_INTEGER : Math.abs(d.getTime() - at);
        return rows
            .sort((x, y) => gap(x.postingDate ?? x.pendingDate) -
            gap(y.postingDate ?? y.pendingDate) || x.id - y.id)
            .slice(0, limit)
            .map((r) => ({
            id: r.id,
            date: day(r.postingDate ?? r.pendingDate),
            amount: Number(r.amount),
            name: r.name,
            description: r.description,
            attachedTotals: [],
        }));
    }
    async candidates(scope, q, statementId) {
        const where = {
            ...(0, scope_1.scopeWhere)(scope),
            ...(statementId ? { statementId } : {}),
            splitOfId: null,
            statement: { deletedAt: null, status: client_1.StatementStatus.DONE },
        };
        if (q.total) {
            const lo = q.total.toFixed(2);
            const hi = (q.total * (1 + attachment_match_util_1.TIP_SLACK)).toFixed(2);
            where.OR = [
                { amount: { gte: lo, lte: hi } },
                { amount: { gte: `-${hi}`, lte: `-${lo}` } },
            ];
        }
        if (q.date) {
            const at = Date.parse(`${q.date}T00:00:00Z`);
            where.AND = [
                {
                    OR: [
                        { postingDate: null },
                        {
                            postingDate: {
                                gte: new Date(at - attachment_match_util_1.DAYS_BEFORE * 86_400_000),
                                lte: new Date(at + attachment_match_util_1.DAYS_AFTER * 86_400_000),
                            },
                        },
                    ],
                },
            ];
        }
        const rows = await this.prisma.bankTransaction.findMany({
            where,
            take: 500,
            select: {
                id: true,
                postingDate: true,
                pendingDate: true,
                amount: true,
                name: true,
                description: true,
                attachments: {
                    where: { deletedAt: null },
                    select: { extracted: true },
                },
            },
        });
        return rows.map((r) => ({
            id: r.id,
            date: day(r.postingDate ?? r.pendingDate),
            amount: Number(r.amount),
            name: r.name,
            description: r.description,
            attachedTotals: r.attachments.flatMap((a) => {
                const t = a.extracted
                    ? readingTotal(a.extracted)
                    : null;
                return t ? [(0, reconcile_util_1.cents)(t)] : [];
            }),
        }));
    }
    async applyItems(scope, attachmentId, replace) {
        const a = await this.prisma.transactionAttachment.findFirst({
            where: { id: attachmentId, ...(0, scope_1.scopeWhere)(scope), deletedAt: null },
            include: {
                transaction: {
                    include: { splits: { select: { id: true }, take: 1 } },
                },
            },
        });
        const parent = a?.transaction;
        const reading = a?.extracted;
        if (!a || !parent || !reading)
            return 'Nothing to split yet.';
        const purchase = a.kind === client_1.AttachmentKind.RECEIPT || reading.kind === 'RECEIPT';
        if (!purchase || !reading.items?.length) {
            return purchase ? 'No items could be read off the receipt.' : null;
        }
        if (!replace && parent.splits.length) {
            return 'The transaction is already split; use "Use receipt items" to replace its splits.';
        }
        const categoryFor = await this.products.categoriesFor(scope, reading.items.map((i) => i.name), { store: reading.vendor, parentCategory: parent.offsetAccount });
        const out = (0, receipt_items_util_1.itemSplits)(reading.items, reading.tax, Number(parent.amount), categoryFor);
        if ('problem' in out)
            return `${out.problem}, so it was not split.`;
        await this.splits.save(scope, parent.id, out.splits.map((s) => ({
            name: parent.name,
            itemName: s.itemName,
            category: s.category,
            amount: s.amount,
        })));
        return null;
    }
};
exports.AttachmentProcessorService = AttachmentProcessorService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_30_SECONDS),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AttachmentProcessorService.prototype, "sweep", null);
exports.AttachmentProcessorService = AttachmentProcessorService = AttachmentProcessorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(6, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        object_storage_service_1.ObjectStorageService,
        attachment_extractor_1.AttachmentExtractor,
        splits_service_1.SplitsService,
        product_memory_service_1.ProductMemoryService,
        name_memory_service_1.NameMemoryService,
        rules_service_1.RulesService])
], AttachmentProcessorService);
//# sourceMappingURL=attachment-processor.service.js.map