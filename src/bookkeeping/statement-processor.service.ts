import { withAiUsage } from '../ai/ai-usage.context';
import { changeFeed } from '../assistant/change-feed';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AttachmentStatus,
  StatementStatus,
  type BankStatement,
} from '@prisma/client';
import { RulesService } from '../assistant/rules.service';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { canonicalAccountName } from './account-identity.util';
import { buildLedgerRows, parseIsoDate } from './ledger.util';
import { NameMemoryService } from './name-memory.service';
import { describeCheck } from './reconcile.util';
import { loadChainHint, queueChainRereads } from './statement-continuity';
import { needsReviewText } from './statement-problem.util';
import {
  StatementExtractor,
  UnreadableStatementError,
} from './statement-extractor';
import { ERROR_DETAIL_MAX, failureReason } from './statement-errors';
import { relinkPlan, type LinkedRow } from './reread-relink.util';
import { StatementImagesService } from './statement-images.service';
import { sweepStaleStaging } from './statement-uploads';
import { TaxService } from './tax.service';
import { claimableAt, MAX_ATTEMPTS } from './queue-retry';
import { scopeOf, scopeWhere, type BookScope } from './scope';

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
    /** step11: the book's learned rules, read before the statement is. Optional for specs. */
    @Optional() private readonly rules?: RulesService,
  ) {}

  /** Kick the queue now, without waiting. Never throws. */
  processSoon(): void {
    void this.sweep().catch(() => undefined);
  }

  /**
   * step2 (2026-11-11): re-read on the strong model both sides of every balance that does
   * not carry over in these accounts (`queueChainRereads`) — after a statement is read,
   * moved or deleted. Never throws.
   */
  async recheckChains(
    scope: BookScope,
    accountNames: Array<string | null> | null,
  ): Promise<void> {
    const queued = await queueChainRereads(this.prisma, scope, accountNames);
    if (!queued) return;
    this.logger.log(
      `book ${scope.bookId}: ${queued} statement(s) queued for a strong re-read — their balances do not carry over`,
    );
    changeFeed.bump(scope.customerId);
    this.processSoon();
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
        await withAiUsage({ ...scopeOf(row), feature: 'STATEMENT' }, () =>
          this.processOne(row),
        );
        // step12h: an open page of this customer refreshes by itself.
        changeFeed.bump(row.customerId);
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
      data: {
        status: StatementStatus.PROCESSING,
        error: null,
        errorDetail: null,
      },
    });
    if (claimed.count === 0) return;

    const started = Date.now();
    // The statement's OWN book: a company's statement is read against that company's
    // accounts, rules and categories, never the customer's general ones.
    const scope = scopeOf(row);
    try {
      const pdf = await this.storage.getBuffer(row.storageKey);
      // One run does every re-read (at most MAX_REREADS); each round refreshes updatedAt
      // so a long run is not mistaken for a crashed one and claimed again.
      const learned =
        (await this.rules?.promptBlock(scope, undefined, 'STATEMENT_READER')) ??
        '';
      const rules = withCustomerNote(learned, row.customerNote);
      // step2: queued because its balances do not carry over to / from a neighbour — this
      // run reads it on the strong model, told where the neighbours end and start.
      const strong =
        row.chainRereadAt !== null &&
        (row.processedAt === null || row.processedAt < row.chainRereadAt);
      const hint = strong
        ? await loadChainHint(this.prisma, scope, row)
        : null;
      const extracted = await this.extractor.extract(pdf, row.filename, {
        rules,
        strong,
        hint,
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
          await this.knownAccounts(scope, row.id),
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
      // step9: the statement id lets the customer's one-time edits (EXCEPTION rules) find
      // their rows again on a re-read.
      const { lines, customAccounts } = await this.names.resolveStatement(
        scope,
        extracted.transactions,
        extracted.bankName,
        row.id,
      );
      const rows = buildLedgerRows(lines, bank, customAccounts);
      const { verification, checks } = extracted.verification;
      const runs = row.runs + 1;
      // step2: the strong re-read of a statement that was in the books never takes it out
      // or makes it worse — the earlier reading stays when this one checks out less well.
      if (strong && RANK[verification] < RANK[row.verification ?? 'UNVERIFIED']) {
        await this.prisma.bankStatement.update({
          where: { id: row.id },
          data: { status: StatementStatus.DONE, runs, processedAt: new Date() },
        });
        this.logger.warn(
          `statement #${row.id}: strong re-read came out ${verification}, worse than the stored ${row.verification} — kept the earlier reading`,
        );
        return;
      }
      const mismatch = verification === 'MISMATCH';
      // Still off after every re-read → set aside with a readable reason. Its rows never
      // reach a customer: the ledger and the exports read DONE statements only. A
      // statement with nothing comparable printed (UNVERIFIED) is released as it is.
      const status = mismatch
        ? StatementStatus.NEEDS_REVIEW
        : StatementStatus.DONE;
      const failed = checks.filter((c) => !c.ok && !c.skipped);
      const money = (n: number | null) => (n === null ? null : n.toFixed(2));
      // step2: the receipts on a statement read before (a re-read of a DONE one) — put
      // back on the same transactions after its rows are replaced.
      const linked = await this.linkedReceipts(row.id);
      const customerSet = customerBalances(row.customerNote);

      await this.prisma.$transaction([
        // Idempotent: a retry after a crash mid-write replaces, never duplicates.
        this.prisma.bankTransaction.deleteMany({
          where: { statementId: row.id },
        }),
        this.prisma.bankTransaction.createMany({
          data: rows.map((r) => ({
            ...r,
            statementId: row.id,
            ...scopeWhere(scope),
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
            // The balances the customer set (`setBalances`) stand when the reader
            // finds none — a re-read used to wipe them (2026-11-11).
            openingBalance: money(
              extracted.stated.openingBalance ?? customerSet.opening,
            ),
            closingBalance: money(
              extracted.stated.closingBalance ?? customerSet.closing,
            ),
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
              ? needsReviewText({
                  rereads: extracted.rereads,
                  checks,
                  openingBalance: extracted.stated.openingBalance,
                  amounts: extracted.transactions.map((t) => t.amount),
                })
              : null,
          },
        }),
      ]);
      if (linked.length) await this.relinkReceipts(row.id, linked, !mismatch);
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
      // step2: does it carry over from / to its neighbours? Both sides of a break are
      // re-read once on the strong model.
      if (!mismatch) await this.recheckChains(scope, [bank]);
      const level = mismatch ? 'warn' : 'log';
      this.logger[level](
        `statement #${row.id} ${status} (${verification}, run ${runs}): ${rows.length} transactions, ` +
          `${extracted.rereads} re-read(s), ${extracted.calls} OpenAI call(s), ${Date.now() - started}ms` +
          (mismatch ? ` — ${failed.map(describeCheck).join('; ')}` : ''),
      );
    } catch (err) {
      // step2: a failed strong re-read leaves the statement as it was (in the books).
      if (
        row.chainRereadAt !== null &&
        (row.processedAt === null || row.processedAt < row.chainRereadAt) &&
        row.verification !== null
      ) {
        this.logger.warn(
          `statement #${row.id}: strong re-read failed (${err instanceof Error ? err.message : String(err)}) — kept the earlier reading`,
        );
        await this.prisma.bankStatement
          .update({
            where: { id: row.id },
            data: { status: StatementStatus.DONE, processedAt: new Date() },
          })
          .catch(() => undefined);
        return;
      }
      await this.recordFailure(row, err);
    }
  }

  /** The book's accounts from its OTHER read statements (name + kind). */
  private async knownAccounts(scope: BookScope, exceptId: number) {
    const rows = await this.prisma.bankStatement.findMany({
      where: {
        ...scopeWhere(scope),
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
              : failureReason(message)
            : null,
          // step2: the raw reason, shown under "Details" on Bank feeds.
          errorDetail: final ? message.slice(0, ERROR_DETAIL_MAX) : null,
        },
      })
      .catch(() => undefined);
  }

  /** The receipts (not cut from this statement) on this statement's rows, before a re-read. */
  private async linkedReceipts(statementId: number): Promise<LinkedRow[]> {
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
    return rows.flatMap((a) =>
      a.transaction
        ? [
            {
              attachmentId: a.id,
              amountCents: Math.round(Number(a.transaction.amount) * 100),
              day: isoDay(
                a.transaction.postingDate ?? a.transaction.pendingDate,
              ),
              description: a.transaction.description,
            },
          ]
        : [],
    );
  }

  /**
   * Put the receipts back on the re-read rows. One with no clear match (or a statement that
   * now needs review, whose rows are out of the ledger) waits UNMATCHED for the customer.
   */
  private async relinkReceipts(
    statementId: number,
    linked: LinkedRow[],
    done: boolean,
  ): Promise<void> {
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
      const plan = relinkPlan(
        linked,
        fresh.map((r) => ({
          id: r.id,
          amountCents: Math.round(Number(r.amount) * 100),
          day: isoDay(r.postingDate ?? r.pendingDate),
          description: r.description,
        })),
      );
      for (const a of linked) {
        const transactionId = plan.get(a.attachmentId);
        await this.prisma.transactionAttachment.update({
          where: { id: a.attachmentId },
          data: transactionId
            ? { transactionId }
            : {
                status: AttachmentStatus.UNMATCHED,
                matchNote:
                  'Its statement was read again and the transaction changed — pick it again.',
              },
        });
      }
      this.logger.log(
        `statement #${statementId}: ${plan.size} of ${linked.length} receipt(s) put back after the re-read`,
      );
    } catch (err) {
      this.logger.warn(
        `statement #${statementId}: receipts not put back: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** YYYY-MM-DD of a @db.Date column, or null. */
function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** How well a reading checked out — a strong re-read may never go down (step2). */
const RANK: Record<string, number> = { MISMATCH: 0, UNVERIFIED: 1, VERIFIED: 2 };

/**
 * step8: what the customer said was wrong with THIS statement (its chat on Bank feeds) goes
 * to the reader after the learned rules, on every re-read of it.
 */
export function withCustomerNote(rules: string, note: string | null): string {
  const text = note?.trim();
  if (!text) return rules;
  // Like every other block appended to the reader's prompt, it starts on a fresh paragraph.
  return `${rules}\n\nThe customer says about THIS statement (follow it when reading it):\n${text}`;
}

/**
 * The opening / closing balance the customer gave for this statement — the LAST
 * "The opening balance is X and closing balance is Y (customer: …)" line `setBalances`
 * wrote into its note ("not printed" or never set = null). Pure.
 */
export function customerBalances(note: string | null): {
  opening: number | null;
  closing: number | null;
} {
  const out: { opening: number | null; closing: number | null } = {
    opening: null,
    closing: null,
  };
  for (const line of (note ?? '').split('\n')) {
    if (!/^The (opening|closing) balance is /.test(line)) continue;
    const head = line.split(' (customer:')[0];
    for (const key of ['opening', 'closing'] as const) {
      const m = new RegExp(
        `${key} balance is (-?\\d+(?:\\.\\d+)?|not printed)`,
      ).exec(head);
      if (m) out[key] = m[1] === 'not printed' ? null : Number(m[1]);
    }
  }
  return out;
}
