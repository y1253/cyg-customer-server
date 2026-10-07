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
var StatementProcessorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatementProcessorService = exports.MAX_RUNS = exports.MAX_ATTEMPTS = void 0;
exports.claimableAt = claimableAt;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const object_storage_service_1 = require("../storage/object-storage.service");
const ledger_util_1 = require("./ledger.util");
const reconcile_util_1 = require("./reconcile.util");
const statement_extractor_1 = require("./statement-extractor");
const statement_uploads_1 = require("./statement-uploads");
exports.MAX_ATTEMPTS = 4;
exports.MAX_RUNS = 3;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];
const CONCURRENCY = 2;
const BATCH = 6;
const STALE_PROCESSING_MS = 15 * 60_000;
function claimableAt(updatedAt, attempts) {
    if (attempts === 0)
        return updatedAt.getTime();
    const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
    return updatedAt.getTime() + delay;
}
let StatementProcessorService = StatementProcessorService_1 = class StatementProcessorService {
    prisma;
    storage;
    extractor;
    logger = new common_1.Logger(StatementProcessorService_1.name);
    sweeping = false;
    constructor(prisma, storage, extractor) {
        this.prisma = prisma;
        this.storage = storage;
        this.extractor = extractor;
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
            claimableAt(s.updatedAt, s.attempts) <= now)
            .slice(0, BATCH);
        if (!due.length)
            return;
        let next = 0;
        const worker = async () => {
            while (next < due.length) {
                const row = due[next++];
                await this.processOne(row);
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
        try {
            const pdf = await this.storage.getBuffer(row.storageKey);
            const extracted = await this.extractor.extract(pdf, row.filename);
            const bank = extracted.accountName ?? 'Bank account';
            const rows = (0, ledger_util_1.buildLedgerRows)(extracted.transactions, bank);
            const { verification, checks } = extracted.verification;
            const runs = row.runs + 1;
            const mismatch = verification === 'MISMATCH';
            const status = !mismatch
                ? client_1.StatementStatus.DONE
                : runs < exports.MAX_RUNS
                    ? client_1.StatementStatus.PENDING
                    : client_1.StatementStatus.NEEDS_REVIEW;
            const money = (n) => (n === null ? null : n.toFixed(2));
            await this.prisma.$transaction([
                this.prisma.bankTransaction.deleteMany({
                    where: { statementId: row.id },
                }),
                this.prisma.bankTransaction.createMany({
                    data: rows.map((r) => ({
                        ...r,
                        statementId: row.id,
                        customerId: row.customerId,
                    })),
                }),
                this.prisma.bankStatement.update({
                    where: { id: row.id },
                    data: {
                        status,
                        runs,
                        ...(status === client_1.StatementStatus.PENDING && { attempts: runs }),
                        accountName: extracted.accountName,
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
                        processedAt: status === client_1.StatementStatus.PENDING ? null : new Date(),
                        error: status === client_1.StatementStatus.NEEDS_REVIEW
                            ? "We read this statement several times and the totals still don't match the bank's figures."
                            : null,
                    },
                }),
            ]);
            const level = mismatch ? 'warn' : 'log';
            this.logger[level](`statement #${row.id} ${status} (${verification}, run ${runs}): ${rows.length} transactions, ` +
                `${extracted.calls} OpenAI call(s), ${Date.now() - started}ms` +
                (mismatch
                    ? ` — ${checks
                        .filter((c) => !c.ok)
                        .map(reconcile_util_1.describeCheck)
                        .join('; ')}`
                    : ''));
            if (status === client_1.StatementStatus.PENDING)
                setTimeout(() => this.processSoon(), 61_000);
        }
        catch (err) {
            await this.recordFailure(row, err);
        }
    }
    async recordFailure(row, err) {
        const message = err instanceof Error ? err.message : String(err);
        const attempts = row.attempts + 1;
        const final = err instanceof statement_extractor_1.UnreadableStatementError || attempts >= exports.MAX_ATTEMPTS;
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
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        object_storage_service_1.ObjectStorageService,
        statement_extractor_1.StatementExtractor])
], StatementProcessorService);
//# sourceMappingURL=statement-processor.service.js.map