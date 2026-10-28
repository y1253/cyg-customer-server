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
exports.needsReviewMessage = needsReviewMessage;
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
const statement_extractor_1 = require("./statement-extractor");
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
            data: { status: client_1.StatementStatus.PROCESSING, error: null },
        });
        if (claimed.count === 0)
            return;
        const started = Date.now();
        const scope = (0, scope_1.scopeOf)(row);
        try {
            const pdf = await this.storage.getBuffer(row.storageKey);
            const rules = (await this.rules?.promptBlock(scope, undefined, 'STATEMENT_READER')) ??
                '';
            const extracted = await this.extractor.extract(pdf, row.filename, {
                rules,
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
            const { lines, customAccounts } = await this.names.resolveStatement(scope, extracted.transactions, extracted.bankName);
            const rows = (0, ledger_util_1.buildLedgerRows)(lines, bank, customAccounts);
            const { verification, checks } = extracted.verification;
            const runs = row.runs + 1;
            const mismatch = verification === 'MISMATCH';
            const status = mismatch
                ? client_1.StatementStatus.NEEDS_REVIEW
                : client_1.StatementStatus.DONE;
            const failed = checks.filter((c) => !c.ok && !c.skipped);
            const money = (n) => (n === null ? null : n.toFixed(2));
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
                        openingBalance: money(extracted.stated.openingBalance),
                        closingBalance: money(extracted.stated.closingBalance),
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
                            ? needsReviewMessage(extracted.rereads, failed.map(reconcile_util_1.describeCheck))
                            : null,
                    },
                }),
            ]);
            if (!mismatch) {
                await this.images.harvest({
                    ...row,
                    accountName,
                    bankName: extracted.bankName,
                    periodStart: (0, ledger_util_1.parseIsoDate)(extracted.periodStart),
                    periodEnd: (0, ledger_util_1.parseIsoDate)(extracted.periodEnd),
                }, pdf, extracted.imagePages);
            }
            const level = mismatch ? 'warn' : 'log';
            this.logger[level](`statement #${row.id} ${status} (${verification}, run ${runs}): ${rows.length} transactions, ` +
                `${extracted.rereads} re-read(s), ${extracted.calls} OpenAI call(s), ${Date.now() - started}ms` +
                (mismatch ? ` — ${failed.map(reconcile_util_1.describeCheck).join('; ')}` : ''));
        }
        catch (err) {
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
                        : 'We could not read this statement. Please try again, or upload a clearer copy.'
                    : null,
            },
        })
            .catch(() => undefined);
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
function needsReviewMessage(rereads, problems) {
    const what = problems.length ? ` (${problems.join('; ')})` : '';
    return (`We re-checked this statement ${rereads} time${rereads === 1 ? '' : 's'} and it still doesn't match the bank's totals${what}. ` +
        "Nothing from it is in your ledger. Try again, or contact us and we'll look at it.");
}
//# sourceMappingURL=statement-processor.service.js.map