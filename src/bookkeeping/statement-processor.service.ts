import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StatementStatus, type BankStatement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { buildLedgerRows, parseIsoDate } from './ledger.util';
import { describeCheck } from './reconcile.util';
import {
  StatementExtractor,
  UnreadableStatementError,
} from './statement-extractor';
import { sweepStaleStaging } from './statement-uploads';

export const MAX_ATTEMPTS = 4;
/**
 * Full reads (each = first read + up to 3 re-read rounds) before a statement that still
 * does not add up is set aside as NEEDS_REVIEW. "Re-read until it matches", with a guard:
 * every round is a paid OpenAI call, and a page that cannot be read will never match.
 */
export const MAX_RUNS = 3;
/** Wait before attempt n+1 (index = attempts so far): 1 min, 5 min, 30 min. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];
const CONCURRENCY = 2;
const BATCH = 6;
/** A row stuck in PROCESSING this long (a restart mid-read) is picked up again. */
const STALE_PROCESSING_MS = 15 * 60_000;

/** When a row with `attempts` failures may be claimed again. */
export function claimableAt(updatedAt: Date, attempts: number): number {
  if (attempts === 0) return updatedAt.getTime();
  const delay =
    RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
  return updatedAt.getTime() + delay;
}

/**
 * Turns uploaded statements into ledger rows.
 *
 * The PENDING rows ARE the queue — the internal app's `CallSummaryService` pattern — so an
 * upload survives a restart. `processSoon` starts work immediately after an upload; the
 * cron is the backstop and the retry path. Each statement is CLAIMED with a conditional
 * update before any OpenAI call, so two ticks (or a tick racing `processSoon`) can never
 * pay to read the same statement twice.
 */
@Injectable()
export class StatementProcessorService {
  private readonly logger = new Logger(StatementProcessorService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly extractor: StatementExtractor,
  ) {}

  /** Kick the queue now, without waiting. Never throws. */
  processSoon(): void {
    void this.sweep().catch(() => undefined);
  }

  /** Staged uploads are deleted by the upload itself; this catches an aborted request or a restart. */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanStaging(): Promise<void> {
    const removed = await sweepStaleStaging(6 * 60 * 60_000);
    if (removed) this.logger.log(`removed ${removed} stale staged upload(s)`);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.runSweep();
    } catch (err) {
      this.logger.error(
        `sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.sweeping = false;
    }
  }

  private async runSweep(): Promise<void> {
    const now = Date.now();
    const candidates = await this.prisma.bankStatement.findMany({
      where: {
        deletedAt: null,
        OR: [
          { status: StatementStatus.PENDING },
          {
            status: StatementStatus.PROCESSING,
            updatedAt: { lt: new Date(now - STALE_PROCESSING_MS) },
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: BATCH * 4,
    });
    const due = candidates
      .filter(
        (s) =>
          s.status === StatementStatus.PROCESSING ||
          claimableAt(s.updatedAt, s.attempts) <= now,
      )
      .slice(0, BATCH);
    if (!due.length) return;

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < due.length) {
        const row = due[next++];
        await this.processOne(row);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker),
    );
    // More may be waiting (a bulk upload); keep going without waiting for the next tick.
    if (due.length === BATCH) setTimeout(() => this.processSoon(), 0);
  }

  private async processOne(row: BankStatement): Promise<void> {
    // Claim: only one runner moves a row out of its current state.
    const claimed = await this.prisma.bankStatement.updateMany({
      where: {
        id: row.id,
        status: row.status,
        updatedAt: row.updatedAt,
        deletedAt: null,
      },
      data: { status: StatementStatus.PROCESSING, error: null },
    });
    if (claimed.count === 0) return;

    const started = Date.now();
    try {
      const pdf = await this.storage.getBuffer(row.storageKey);
      const extracted = await this.extractor.extract(pdf, row.filename);
      const bank = extracted.accountName ?? 'Bank account';
      const rows = buildLedgerRows(extracted.transactions, bank);
      const { verification, checks } = extracted.verification;
      const runs = row.runs + 1;
      const mismatch = verification === 'MISMATCH';
      // A mismatch goes back to the queue for another full read (with backoff) until
      // MAX_RUNS; only then is it set aside. Either way its rows never reach a customer:
      // the ledger and the exports read DONE statements only.
      const status = !mismatch
        ? StatementStatus.DONE
        : runs < MAX_RUNS
          ? StatementStatus.PENDING
          : StatementStatus.NEEDS_REVIEW;
      const money = (n: number | null) => (n === null ? null : n.toFixed(2));

      await this.prisma.$transaction([
        // Idempotent: a retry after a crash mid-write replaces, never duplicates.
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
            // Mismatch retries share the error backoff: 1 min, then 5 min.
            ...(status === StatementStatus.PENDING && { attempts: runs }),
            accountName: extracted.accountName,
            bankName: extracted.bankName,
            periodStart: parseIsoDate(extracted.periodStart),
            periodEnd: parseIsoDate(extracted.periodEnd),
            openingBalance: money(extracted.stated.openingBalance),
            closingBalance: money(extracted.stated.closingBalance),
            statedDeposits: money(extracted.stated.totalDeposits),
            statedWithdrawals: money(extracted.stated.totalWithdrawals),
            statedDepositCount: extracted.stated.depositCount,
            statedWithdrawalCount: extracted.stated.withdrawalCount,
            verification,
            verificationDetail: checks.map((c) => ({
              ...c,
              text: describeCheck(c),
            })),
            transactionCount: rows.length,
            processedAt: status === StatementStatus.PENDING ? null : new Date(),
            error:
              status === StatementStatus.NEEDS_REVIEW
                ? "We read this statement several times and the totals still don't match the bank's figures."
                : null,
          },
        }),
      ]);
      const level = mismatch ? 'warn' : 'log';
      this.logger[level](
        `statement #${row.id} ${status} (${verification}, run ${runs}): ${rows.length} transactions, ` +
          `${extracted.calls} OpenAI call(s), ${Date.now() - started}ms` +
          (mismatch
            ? ` — ${checks
                .filter((c) => !c.ok)
                .map(describeCheck)
                .join('; ')}`
            : ''),
      );
      if (status === StatementStatus.PENDING)
        setTimeout(() => this.processSoon(), 61_000);
    } catch (err) {
      await this.recordFailure(row, err);
    }
  }

  private async recordFailure(row: BankStatement, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = row.attempts + 1;
    // An unreadable file fails the same way every time — no point paying to retry it.
    const final =
      err instanceof UnreadableStatementError || attempts >= MAX_ATTEMPTS;
    this.logger.warn(
      `statement #${row.id} attempt ${attempts} failed${final ? ' (final)' : ''}: ${message}`,
    );
    await this.prisma.bankStatement
      .update({
        where: { id: row.id },
        data: {
          attempts,
          status: final ? StatementStatus.FAILED : StatementStatus.PENDING,
          error: final
            ? err instanceof UnreadableStatementError
              ? message
              : 'We could not read this statement. Please try again, or upload a clearer copy.'
            : null,
        },
      })
      .catch(() => undefined);
  }
}
