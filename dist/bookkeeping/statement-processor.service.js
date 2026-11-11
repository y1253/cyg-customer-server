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
var StatementProcessorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatementProcessorService = exports.MAX_ATTEMPTS = exports.claimableAt = void 0;
exports.withCustomerNote = withCustomerNote;
exports.customerBalances = customerBalances;
const ai_usage_context_1 = require("../ai/ai-usage.context");
const change_feed_1 = require("../assistant/change-feed");
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const client_1 = require("@prisma/client");
const rules_service_1 = require("../assistant/rules.service");
const prisma_service_1 = require("../prisma/prisma.service");
const object_storage_service_1 = require("../storage/object-storage.service");
const account_identity_util_1 = require("./account-identity.util");
const ledger_util_1 = require("./ledger.util");
const name_memory_service_1 = require("./name-memory.service");
const reconcile_util_1 = require("./reconcile.util");
const statement_continuity_1 = require("./statement-continuity");
const statement_problem_util_1 = require("./statement-problem.util");
const statement_extractor_1 = require("./statement-extractor");
const statement_errors_1 = require("./statement-errors");
const reread_relink_util_1 = require("./reread-relink.util");
const statement_images_service_1 = require("./statement-images.service");
const statement_uploads_1 = require("./statement-uploads");
const tax_service_1 = require("./tax.service");
const queue_retry_1 = require("./queue-retry");
Object.defineProperty(exports, "claimableAt", { enumerable: true, get: function () { return queue_retry_1.claimableAt; } });
Object.defineProperty(exports, "MAX_ATTEMPTS", { enumerable: true, get: function () { return queue_retry_1.MAX_ATTEMPTS; } });
const scope_1 = require("./scope");
const CONCURRENCY = 2;
const BATCH = 6;
const STALE_PROCESSING_MS = 15 * 60_000;
let StatementProcessorService = StatementProcessorService_1 = class StatementProcessorService {
    prisma;
    storage;
    extractor;
    tax;
    names;
    images;
    rules;
    logger = new common_1.Logger(StatementProcessorService_1.name);
    sweeping = false;
    constructor(prisma, storage, extractor, tax, names, images, rules) {
        this.prisma = prisma;
        this.storage = storage;
        this.extractor = extractor;
        this.tax = tax;
        this.names = names;
        this.images = images;
        this.rules = rules;
    }
    processSoon() {
        void this.sweep().catch(() => undefined);
    }
    async recheckChains(scope, accountNames) {
        const queued = await (0, statement_continuity_1.queueChainRereads)(this.prisma, scope, accountNames);
        if (!queued)
            return;
        this.logger.log(`book ${scope.bookId}: ${queued} statement(s) queued for a strong re-read — their balances do not carry over`);
        change_feed_1.changeFeed.bump(scope.customerId);
        this.processSoon();
    }
    async cleanStaging() {
        const removed = await (0, statement_uploads_1.sweepStaleStaging)(6 * 60 * 60_000);
        if (removed)
            this.logger.log(`removed ${removed} stale staged upload(s)`);
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
        const candidates = await this.prisma.bankStatement.findMany({
            where: {
                deletedAt: null,
                OR: [
                    { status: client_1.StatementStatus.PENDING },
                    {
                        status: client_1.StatementStatus.PROCESSING,
                        updatedAt: { lt: new Date(now - STALE_PROCESSING_MS) },
                    },
                ],
            },
            orderBy: { updatedAt: 'asc' },
            take: BATCH * 4,
        });
        const due = candidates
            .filter((s) => s.status === client_1.StatementStatus.PROCESSING ||
            (0, queue_retry_1.claimableAt)(s.updatedAt, s.attempts) <= now)
            .slice(0, BATCH);
        if (!due.length)
            return;
        let next = 0;
        const worker = async () => {
            while (next < due.length) {
                const row = due[next++];
                await (0, ai_usage_context_1.withAiUsage)({ ...(0, scope_1.scopeOf)(row), feature: 'STATEMENT' }, () => this.processOne(row));
                change_feed_1.changeFeed.bump(row.customerId);
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
        if (due.length === BATCH)
            setTimeout(() => this.processSoon(), 0);
    }
    async processOne(row) {
        const claimed = await this.prisma.bankStatement.updateMany({
            where: {
                id: row.id,
                status: row.status,
                updatedAt: row.updatedAt,
                deletedAt: null,
            },
            data: {
                status: client_1.StatementStatus.PROCESSING,
                error: null,
                errorDetail: null,
            },
        });
        if (claimed.count === 0)
            return;
        const started = Date.now();
        const scope = (0, scope_1.scopeOf)(row);
        try {
            const pdf = await this.storage.getBuffer(row.storageKey);
            const learned = (await this.rules?.promptBlock(scope, undefined, 'STATEMENT_READER')) ??
                '';
            const rules = withCustomerNote(learned, row.customerNote);
            const strong = row.chainRereadAt !== null &&
                (row.processedAt === null || row.processedAt < row.chainRereadAt);
            const hint = strong
                ? await (0, statement_continuity_1.loadChainHint)(this.prisma, scope, row)
                : null;
            const extracted = await this.extractor.extract(pdf, row.filename, {
                rules,
                strong,
                hint,
                onRound: async () => {
                    await this.prisma.bankStatement.updateMany({
                        where: { id: row.id, status: client_1.StatementStatus.PROCESSING },
                        data: { updatedAt: new Date() },
                    });
                },
            });
            const accountName = row.accountNameByCustomer ??
                (0, account_identity_util_1.canonicalAccountName)(extracted, await this.knownAccounts(scope, row.id));
            if (accountName !== extracted.accountName) {
                this.logger.log(`statement #${row.id}: account "${extracted.accountName}" filed as "${accountName}"`);
            }
            const bank = accountName ?? 'Bank account';
            const { lines, customAccounts } = await this.names.resolveStatement(scope, extracted.transactions, extracted.bankName, row.id);
            const rows = (0, ledger_util_1.buildLedgerRows)(lines, bank, customAccounts);
            const { verification, checks } = extracted.verification;
            const runs = row.runs + 1;
            if (strong && RANK[verification] < RANK[row.verification ?? 'UNVERIFIED']) {
                await this.prisma.bankStatement.update({
                    where: { id: row.id },
                    data: { status: client_1.StatementStatus.DONE, runs, processedAt: new Date() },
                });
                this.logger.warn(`statement #${row.id}: strong re-read came out ${verification}, worse than the stored ${row.verification} — kept the earlier reading`);
                return;
            }
            const mismatch = verification === 'MISMATCH';
            const status = mismatch
                ? client_1.StatementStatus.NEEDS_REVIEW
                : client_1.StatementStatus.DONE;
            const failed = checks.filter((c) => !c.ok && !c.skipped);
            const money = (n) => (n === null ? null : n.toFixed(2));
            const linked = await this.linkedReceipts(row.id);
            const customerSet = customerBalances(row.customerNote);
            await this.prisma.$transaction([
                this.prisma.bankTransaction.deleteMany({
                    where: { statementId: row.id },
                }),
                this.prisma.bankTransaction.createMany({
                    data: rows.map((r) => ({
                        ...r,
                        statementId: row.id,
                        ...(0, scope_1.scopeWhere)(scope),
                    })),
                }),
                this.prisma.bankStatement.update({
                    where: { id: row.id },
                    data: {
                        status,
                        runs,
                        accountName,
                        accountKind: row.accountNameByCustomer
                            ? (row.accountKind ?? extracted.accountKind)
                            : extracted.accountKind,
                        currency: extracted.currency,
                        bankName: extracted.bankName,
                        periodStart: (0, ledger_util_1.parseIsoDate)(extracted.periodStart),
                        periodEnd: (0, ledger_util_1.parseIsoDate)(extracted.periodEnd),
                        openingBalance: money(extracted.stated.openingBalance ?? customerSet.opening),
                        closingBalance: money(extracted.stated.closingBalance ?? customerSet.closing),
                        statedDeposits: money(extracted.stated.totalDeposits),
                        statedWithdrawals: money(extracted.stated.totalWithdrawals),
                        statedDepositCount: extracted.stated.depositCount,
                        statedWithdrawalCount: extracted.stated.withdrawalCount,
                        verification,
                        verificationDetail: checks.map((c) => ({
                            ...c,
                            text: (0, reconcile_util_1.describeCheck)(c),
                        })),
                        transactionCount: rows.length,
                        processedAt: new Date(),
                        error: mismatch
                            ? (0, statement_problem_util_1.needsReviewText)({
                                rereads: extracted.rereads,
                                checks,
                                openingBalance: extracted.stated.openingBalance,
                                amounts: extracted.transactions.map((t) => t.amount),
                            })
                            : null,
                    },
                }),
            ]);
            if (linked.length)
                await this.relinkReceipts(row.id, linked, !mismatch);
            if (!mismatch) {
                await this.images.harvest({
                    ...row,
                    accountName,
                    bankName: extracted.bankName,
                    periodStart: (0, ledger_util_1.parseIsoDate)(extracted.periodStart),
                    periodEnd: (0, ledger_util_1.parseIsoDate)(extracted.periodEnd),
                }, pdf, extracted.imagePages);
            }
            if (!mismatch)
                await this.recheckChains(scope, [bank]);
            const level = mismatch ? 'warn' : 'log';
            this.logger[level](`statement #${row.id} ${status} (${verification}, run ${runs}): ${rows.length} transactions, ` +
                `${extracted.rereads} re-read(s), ${extracted.calls} OpenAI call(s), ${Date.now() - started}ms` +
                (mismatch ? ` — ${failed.map(reconcile_util_1.describeCheck).join('; ')}` : ''));
        }
        catch (err) {
            if (row.chainRereadAt !== null &&
                (row.processedAt === null || row.processedAt < row.chainRereadAt) &&
                row.verification !== null) {
                this.logger.warn(`statement #${row.id}: strong re-read failed (${err instanceof Error ? err.message : String(err)}) — kept the earlier reading`);
                await this.prisma.bankStatement
                    .update({
                    where: { id: row.id },
                    data: { status: client_1.StatementStatus.DONE, processedAt: new Date() },
                })
                    .catch(() => undefined);
                return;
            }
            await this.recordFailure(row, err);
        }
    }
    async knownAccounts(scope, exceptId) {
        const rows = await this.prisma.bankStatement.findMany({
            where: {
                ...(0, scope_1.scopeWhere)(scope),
                id: { not: exceptId },
                deletedAt: null,
                accountName: { not: null },
            },
            distinct: ['accountName', 'accountKind'],
            select: { accountName: true, accountKind: true },
        });
        return rows.map((r) => ({ name: r.accountName, kind: r.accountKind }));
    }
    async recordFailure(row, err) {
        const message = err instanceof Error ? err.message : String(err);
        const attempts = row.attempts + 1;
        const final = err instanceof statement_extractor_1.UnreadableStatementError || attempts >= queue_retry_1.MAX_ATTEMPTS;
        this.logger.warn(`statement #${row.id} attempt ${attempts} failed${final ? ' (final)' : ''}: ${message}`);
        await this.prisma.bankStatement
            .update({
            where: { id: row.id },
            data: {
                attempts,
                status: final ? client_1.StatementStatus.FAILED : client_1.StatementStatus.PENDING,
                error: final
                    ? err instanceof statement_extractor_1.UnreadableStatementError
                        ? message
                        : (0, statement_errors_1.failureReason)(message)
                    : null,
                errorDetail: final ? message.slice(0, statement_errors_1.ERROR_DETAIL_MAX) : null,
            },
        })
            .catch(() => undefined);
    }
    async linkedReceipts(statementId) {
        const rows = await this.prisma.transactionAttachment.findMany({
            where: {
                deletedAt: null,
                transaction: { statementId },
                NOT: { sourceRef: { startsWith: `stmt:${statementId}:` } },
            },
            select: {
                id: true,
                transaction: {
                    select: {
                        amount: true,
                        postingDate: true,
                        pendingDate: true,
                        description: true,
                    },
                },
            },
        });
        return rows.flatMap((a) => a.transaction
            ? [
                {
                    attachmentId: a.id,
                    amountCents: Math.round(Number(a.transaction.amount) * 100),
                    day: isoDay(a.transaction.postingDate ?? a.transaction.pendingDate),
                    description: a.transaction.description,
                },
            ]
            : []);
    }
    async relinkReceipts(statementId, linked, done) {
        try {
            const fresh = done
                ? await this.prisma.bankTransaction.findMany({
                    where: { statementId, splitOfId: null },
                    select: {
                        id: true,
                        amount: true,
                        postingDate: true,
                        pendingDate: true,
                        description: true,
                    },
                })
                : [];
            const plan = (0, reread_relink_util_1.relinkPlan)(linked, fresh.map((r) => ({
                id: r.id,
                amountCents: Math.round(Number(r.amount) * 100),
                day: isoDay(r.postingDate ?? r.pendingDate),
                description: r.description,
            })));
            for (const a of linked) {
                const transactionId = plan.get(a.attachmentId);
                await this.prisma.transactionAttachment.update({
                    where: { id: a.attachmentId },
                    data: transactionId
                        ? { transactionId }
                        : {
                            status: client_1.AttachmentStatus.UNMATCHED,
                            matchNote: 'Its statement was read again and the transaction changed — pick it again.',
                        },
                });
            }
            this.logger.log(`statement #${statementId}: ${plan.size} of ${linked.length} receipt(s) put back after the re-read`);
        }
        catch (err) {
            this.logger.warn(`statement #${statementId}: receipts not put back: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
};
exports.StatementProcessorService = StatementProcessorService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_HOUR),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], StatementProcessorService.prototype, "cleanStaging", null);
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_30_SECONDS),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], StatementProcessorService.prototype, "sweep", null);
exports.StatementProcessorService = StatementProcessorService = StatementProcessorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(6, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        object_storage_service_1.ObjectStorageService,
        statement_extractor_1.StatementExtractor,
        tax_service_1.TaxService,
        name_memory_service_1.NameMemoryService,
        statement_images_service_1.StatementImagesService,
        rules_service_1.RulesService])
], StatementProcessorService);
function isoDay(d) {
    return d ? d.toISOString().slice(0, 10) : null;
}
const RANK = { MISMATCH: 0, UNVERIFIED: 1, VERIFIED: 2 };
function withCustomerNote(rules, note) {
    const text = note?.trim();
    if (!text)
        return rules;
    return `${rules}\n\nThe customer says about THIS statement (follow it when reading it):\n${text}`;
}
function customerBalances(note) {
    const out = {
        opening: null,
        closing: null,
    };
    for (const line of (note ?? '').split('\n')) {
        if (!/^The (opening|closing) balance is /.test(line))
            continue;
        const head = line.split(' (customer:')[0];
        for (const key of ['opening', 'closing']) {
            const m = new RegExp(`${key} balance is (-?\\d+(?:\\.\\d+)?|not printed)`).exec(head);
            if (m)
                out[key] = m[1] === 'not printed' ? null : Number(m[1]);
        }
    }
    return out;
}
//# sourceMappingURL=statement-processor.service.js.map