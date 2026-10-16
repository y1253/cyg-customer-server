import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StatementStatus, type BankStatement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { canonicalAccountName } from './account-identity.util';
import { buildLedgerRows, parseIsoDate } from './ledger.util';
import { NameMemoryService } from './name-memory.service';
import { describeCheck } from './reconcile.util';
import {
  StatementExtractor,
  UnreadableStatementError,
} from './statement-extractor';
import { StatementImagesService } from './statement-images.service';
import { sweepStaleStaging } from './statement-uploads';
import { TaxService } from './tax.service';
import { claimableAt, MAX_ATTEMPTS } from './queue-retry';

export { claimableAt, MAX_ATTEMPTS };

const CONCURRENCY = 2;
const BATCH = 6;
/** A row stuck in PROCESSING this long (a restart mid-read) is picked up again. */
const STALE_PROCESSING_MS = 15 * 60_000;

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
    private readonly tax: TaxService,
    private readonly names: NameMemoryService,
    private readonly images: StatementImagesService,
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
      // One run does every re-read (at most MAX_REREADS); each round refreshes updatedAt
      // so a long run is not mistaken for a crashed one and claimed again.
      const extracted = await this.extractor.extract(pdf, row.filename, {
        onRound: async () => {
          await this.prisma.bankStatement.updateMany({
            where: { id: row.id, status: StatementStatus.PROCESSING },
            data: { updatedAt: new Date() },
          });
        },
      });
      // The AI's account name is free text ("TD 5234" on one statement, "TD 5234496" on
      // the next) and an account IS its name everywhere downstream — so file the statement
      // under the account the customer already has when it is the same one
      // (`account-identity.util.ts`).
      // A statement the customer filed under an account themselves stays there.
      const accountName =
        row.accountNameByCustomer ??
        canonicalAccountName(
          extracted,
          await this.knownAccounts(row.customerId, row.id),
        );
      if (accountName !== extracted.accountName) {
        this.logger.log(
          `statement #${row.id}: account "${extracted.accountName}" filed as "${accountName}"`,
        );
      }
      const bank = accountName ?? 'Bank account';
      // The customer's own rules first, then the firm memory, then the AI's guess — and
      // the memory learns this statement's new descriptions (`name-memory.util.ts`). Bank
      // fees and interest with no payee are named after the bank.
      const { lines, customAccounts } = await this.names.resolveStatement(
        row.customerId,
        extracted.transactions,
        extracted.bankName,
      );
      const rows = buildLedgerRows(lines, bank, customAccounts);
      const { verification, checks } = extracted.verification;
      const runs = row.runs + 1;
      const mismatch = verification === 'MISMATCH';
      // Still off after every re-read → set aside with a readable reason. Its rows never
      // reach a customer: the ledger and the exports read DONE statements only. A
      // statement with nothing comparable printed (UNVERIFIED) is released as it is.
      const status = mismatch
        ? StatementStatus.NEEDS_REVIEW
        : StatementStatus.DONE;
      const failed = checks.filter((c) => !c.ok && !c.skipped);
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
            accountName,
            // A customer-filed statement keeps the kind of the folder it was put in.
            accountKind: row.accountNameByCustomer
              ? (row.accountKind ?? extracted.accountKind)
              : extracted.accountKind,
            currency: extracted.currency,
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
            processedAt: new Date(),
            error: mismatch
              ? needsReviewMessage(extracted.rereads, failed.map(describeCheck))
              : null,
          },
        }),
      ]);
      if (!mismatch) {
        // Cheque / deposit-slip images become attachments on their rows (never fails).
        await this.images.harvest(
          {
            ...row,
            accountName,
            bankName: extracted.bankName,
            periodStart: parseIsoDate(extracted.periodStart),
            periodEnd: parseIsoDate(extracted.periodEnd),
          },
          pdf,
          extracted.imagePages,
        );
      }
      const level = mismatch ? 'warn' : 'log';
      this.logger[level](
        `statement #${row.id} ${status} (${verification}, run ${runs}): ${rows.length} transactions, ` +
          `${extracted.rereads} re-read(s), ${extracted.calls} OpenAI call(s), ${Date.now() - started}ms` +
          (mismatch ? ` — ${failed.map(describeCheck).join('; ')}` : ''),
      );
    } catch (err) {
      await this.recordFailure(row, err);
    }
  }

  /** The customer's accounts from their OTHER read statements (name + kind). */
  private async knownAccounts(customerId: number, exceptId: number) {
    const rows = await this.prisma.bankStatement.findMany({
      where: {
        customerId,
        id: { not: exceptId },
        deletedAt: null,
        accountName: { not: null },
      },
      distinct: ['accountName', 'accountKind'],
      select: { accountName: true, accountKind: true },
    });
    return rows.map((r) => ({ name: r.accountName!, kind: r.accountKind }));
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

/**
 * The customer-facing reason a statement was set aside:
 * "We re-checked this statement 10 times and it still doesn't match the bank's totals
 * (Withdrawals: statement $4,812.40, read $4,728.03 (off by $84.37)). …"
 */
export function needsReviewMessage(
  rereads: number,
  problems: string[],
): string {
  const what = problems.length ? ` (${problems.join('; ')})` : '';
  return (
    `We re-checked this statement ${rereads} time${rereads === 1 ? '' : 's'} and it still doesn't match the bank's totals${what}. ` +
    "Nothing from it is in your ledger. Try again, or contact us and we'll look at it."
  );
}
