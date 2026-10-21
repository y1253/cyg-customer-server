import { Injectable, Logger, Optional } from '@nestjs/common';
import { RulesService } from '../assistant/rules.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AttachmentKind,
  AttachmentStatus,
  Prisma,
  StatementStatus,
  type TransactionAttachment,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  AttachmentExtractor,
  UnreadableAttachmentError,
  isPaymentDocument,
  type AttachmentReading,
} from './attachment-extractor';
import {
  DAYS_AFTER,
  DAYS_BEFORE,
  MAX_FOR_AI,
  TIP_SLACK,
  chequeAmountMatch,
  chequeNumberMatch,
  obviousMatch,
  shortlist,
  statementOf,
  type MatchCandidate,
  type MatchQuery,
} from './attachment-match.util';
import type { AttachmentClass } from './attachment-uploads';
import { NameMemoryService } from './name-memory.service';
import { cleanName } from './name-memory.util';
import { ProductMemoryService } from './product-memory.service';
import { itemSplits } from './receipt-items.util';
import { cents } from './reconcile.util';
import { SplitsService } from './splits.service';
import { claimableAt, MAX_ATTEMPTS } from './queue-retry';
import { scopeOf, scopeWhere, type BookScope } from './scope';

const CONCURRENCY = 2;
/** A row name that says nothing about who was paid ("Cheque", "CHQ 123", "Check #55"). */
const GENERIC_CHEQUE_NAME = /^(cheque|check|chq|chk)\b/i;
const BATCH = 6;
/** A row stuck in PROCESSING this long (a restart mid-read) is picked up again. */
const STALE_PROCESSING_MS = 10 * 60_000;

const day = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/** "IMG_1.jpg" → "IMG_1.jpg (2 of 2)" — a sibling's name on the Attachments tab. */
export function siblingName(
  filename: string,
  n: number,
  total: number,
): string {
  return `${filename.slice(0, 230)} (${n + 1} of ${total})`;
}

/** The amount a reading says was paid: the total, else subtotal + tax, else Σ items. */
export function readingTotal(r: AttachmentReading): number | null {
  if (r.total) return r.total;
  if (r.subtotal) return (cents(r.subtotal) + cents(r.tax ?? 0)) / 100;
  const items = r.items.reduce((n, i) => n + cents(i.amount), 0);
  return items > 0 ? (items + cents(r.tax ?? 0)) / 100 : null;
}

/**
 * step11b: a file that held several documents (two cheques in one photo) keeps the first on
 * its own row; every other one is a SIBLING row on the same stored file, `doc:<rowId>:<n>`.
 */
export const siblingRef = (rowId: number, n: number): string =>
  `doc:${rowId}:${n}`;

/** The original row and document index of a sibling's `sourceRef`, else null. */
export function siblingOf(
  sourceRef: string | null | undefined,
): { rowId: number; index: number } | null {
  const m = /^doc:(\d+):(\d+)$/.exec(sourceRef ?? '');
  return m ? { rowId: Number(m[1]), index: Number(m[2]) } : null;
}

/** The stored kind for what was read: audio and texts keep theirs, a file is what it is. */
export function kindFor(
  cls: AttachmentClass,
  reading: AttachmentReading,
): AttachmentKind {
  if (cls === 'audio') return AttachmentKind.AUDIO;
  if (cls === 'text') return AttachmentKind.TEXT;
  switch (reading.documentType) {
    case 'INVOICE':
      return AttachmentKind.INVOICE;
    case 'CHECK':
      return AttachmentKind.CHECK;
    case 'DEPOSIT_SLIP':
      return AttachmentKind.DEPOSIT_SLIP;
    case 'DOCUMENT':
      return AttachmentKind.DOCUMENT;
    case 'BANK_STATEMENT':
      return AttachmentKind.OTHER;
    case 'RECEIPT':
    case 'PAYMENT_NOTE':
      return AttachmentKind.RECEIPT;
    default:
      return AttachmentKind[reading.kind];
  }
}

/** What an attachment is, from its stored type: audio and PDFs by mime, the rest images. */
export function classOf(mimeType: string): AttachmentClass {
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('text/plain')) return 'text';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'image';
}

/**
 * Reads uploaded attachments and links each to its transaction.
 *
 * The statements' queue pattern: PENDING rows ARE the queue, `processSoon` starts work
 * right after an upload, the cron is the backstop and the retry path, and each row is
 * CLAIMED with a conditional update before any OpenAI call.
 *
 * Every lookup for a row runs in the row's OWN book (`scopeOf(row)`): a company's receipt
 * is matched against that company's transactions and split with its rules, never the
 * customer's general book or another company's.
 *
 * Matching: code shortlists the customer's transactions by sign, amount and date
 * (`attachment-match.util.ts`); one obvious hit is taken as is, otherwise the AI picks
 * among the shortlist and must say it is confident. A receipt's items then become the
 * transaction's splits — but only on a transaction that has none yet, so a customer's
 * own splits are never overwritten behind their back.
 */
@Injectable()
export class AttachmentProcessorService {
  private readonly logger = new Logger(AttachmentProcessorService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly extractor: AttachmentExtractor,
    private readonly splits: SplitsService,
    private readonly products: ProductMemoryService,
    private readonly names: NameMemoryService,
    /** step11: the book's learned rules, read before every AI step. Optional for specs. */
    @Optional() private readonly rules?: RulesService,
  ) {}

  /** Kick the queue now, without waiting. Never throws. */
  processSoon(): void {
    void this.sweep().catch(() => undefined);
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
    const candidates = await this.prisma.transactionAttachment.findMany({
      where: {
        deletedAt: null,
        OR: [
          { status: AttachmentStatus.PENDING },
          {
            status: AttachmentStatus.PROCESSING,
            updatedAt: { lt: new Date(now - STALE_PROCESSING_MS) },
          },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: BATCH * 4,
    });
    const due = candidates
      .filter(
        (a) =>
          a.status === AttachmentStatus.PROCESSING ||
          claimableAt(a.updatedAt, a.attempts) <= now,
      )
      .slice(0, BATCH);
    if (!due.length) return;

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < due.length) await this.processOne(due[next++]);
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker),
    );
    if (due.length === BATCH) setTimeout(() => this.processSoon(), 0);
  }

  private async processOne(row: TransactionAttachment): Promise<void> {
    const claimed = await this.prisma.transactionAttachment.updateMany({
      where: {
        id: row.id,
        status: row.status,
        updatedAt: row.updatedAt,
        deletedAt: null,
      },
      data: { status: AttachmentStatus.PROCESSING, error: null },
    });
    if (claimed.count === 0) return;

    const scope = scopeOf(row);
    try {
      const cls = classOf(row.mimeType);
      const file = await this.storage.getBuffer(row.storageKey);
      const readings = await this.extractor.read(
        file,
        row.filename,
        row.mimeType,
        cls,
        day(row.createdAt)!,
        row.message,
        (await this.rules?.promptBlock(scope)) ?? '',
      );
      const sibling = siblingOf(row.sourceRef);
      if (sibling) {
        // A sibling read again keeps ITS document of the file (the first one if the file
        // now reads as fewer documents).
        const reading = readings[sibling.index] ?? readings[0];
        const parent = await this.prisma.transactionAttachment.findUnique({
          where: { id: sibling.rowId },
          select: { sourceRef: true },
        });
        await this.finish(
          row,
          scope,
          cls,
          reading,
          statementOf(parent?.sourceRef),
        );
        return;
      }
      await this.finish(
        row,
        scope,
        cls,
        readings[0],
        statementOf(row.sourceRef),
      );
      await this.fileSiblings(row, scope, cls, readings);
    } catch (err) {
      await this.recordFailure(row, err);
    }
  }

  /**
   * step11b: one reading onto one row. A payment is matched to a transaction; a statement is
   * left for the customer (or the assistant) to file as one; anything else is a DOCUMENT —
   * kept with what it says, never forced onto a transaction.
   */
  private async finish(
    row: TransactionAttachment,
    scope: BookScope,
    cls: AttachmentClass,
    reading: AttachmentReading,
    statementId: number | null,
  ): Promise<void> {
    const kind = kindFor(cls, reading);
    let transactionId = row.transactionId;
    let note: string;
    let status: AttachmentStatus;
    if (transactionId) {
      note = 'Added from the transaction.';
      status = AttachmentStatus.MATCHED;
    } else if (reading.documentType === 'BANK_STATEMENT') {
      note =
        row.mimeType === 'application/pdf'
          ? 'This looks like a bank statement, not a receipt. Ask the assistant to file it as a statement, or upload it on the Statements tab.'
          : 'This looks like a bank statement. Upload it as a PDF on the Statements tab so its transactions are read.';
      status = AttachmentStatus.UNMATCHED;
    } else if (!isPaymentDocument(reading.documentType)) {
      note =
        reading.summary || 'Not a receipt or a payment — kept as a document.';
      status = AttachmentStatus.DOCUMENT;
    } else {
      const found = await this.match(scope, reading, row.message, statementId);
      transactionId = found.transactionId;
      note = found.note;
      status = transactionId
        ? AttachmentStatus.MATCHED
        : AttachmentStatus.UNMATCHED;
    }

    await this.prisma.transactionAttachment.update({
      where: { id: row.id },
      data: {
        kind,
        extracted: reading as unknown as Prisma.InputJsonValue,
        transactionId,
        status,
        matchNote: note.slice(0, 512),
        error: null,
      },
    });
    if (transactionId && kind === AttachmentKind.CHECK) {
      // Never fails the match: the cheque is attached either way.
      await this.nameFromCheque(scope, transactionId, reading).catch(
        (err: unknown) =>
          this.logger.warn(
            `attachment #${row.id}: payee not applied: ${err instanceof Error ? err.message : String(err)}`,
          ),
      );
    }
    if (transactionId) {
      // The match stands even if splitting fails (e.g. a category since removed).
      const itemsNote = await this.applyItems(scope, row.id, false).catch(
        (err: unknown) =>
          `The items could not be split: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (itemsNote) {
        await this.prisma.transactionAttachment.update({
          where: { id: row.id },
          data: { matchNote: `${note} ${itemsNote}`.slice(0, 512) },
        });
      }
    }
    this.logger.log(
      `attachment #${row.id}${scope.companyId ? ` (company #${scope.companyId})` : ''} (${kind}) ${status === AttachmentStatus.MATCHED ? `matched #${transactionId}` : status.toLowerCase()}`,
    );
  }

  /**
   * step11b: the 2nd, 3rd… document of a file each get their own row on the SAME stored
   * file (`doc:<rowId>:<n>`) and are matched on their own. A re-read reuses those rows and
   * drops the ones the file no longer shows (unless the customer attached them since).
   */
  private async fileSiblings(
    row: TransactionAttachment,
    scope: BookScope,
    cls: AttachmentClass,
    readings: AttachmentReading[],
  ): Promise<void> {
    const existing = await this.prisma.transactionAttachment.findMany({
      where: { sourceRef: { startsWith: `doc:${row.id}:` } },
    });
    const byRef = new Map(existing.map((x) => [x.sourceRef, x]));
    const wanted = new Set<string>();
    for (let n = 1; n < readings.length; n++) {
      const ref = siblingRef(row.id, n);
      wanted.add(ref);
      const had = byRef.get(ref);
      // A sibling the customer deleted stays deleted.
      if (had?.deletedAt) continue;
      const sib =
        had ??
        (await this.prisma.transactionAttachment.create({
          data: {
            customerId: row.customerId,
            companyId: row.companyId,
            kind: row.kind,
            status: AttachmentStatus.PROCESSING,
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
      if (had && had.transactionId && had.status === AttachmentStatus.MATCHED) {
        continue; // already filed (by us or by the customer): leave it
      }
      await this.finish(
        { ...sib, transactionId: had?.transactionId ?? null },
        scope,
        cls,
        readings[n],
        statementOf(row.sourceRef),
      ).catch((err: unknown) => this.recordFailure(sib, err));
    }
    const gone = existing.filter(
      (x) => !wanted.has(x.sourceRef ?? '') && !x.deletedAt && !x.transactionId,
    );
    if (gone.length) {
      await this.prisma.transactionAttachment.updateMany({
        where: { id: { in: gone.map((x) => x.id) } },
        data: { deletedAt: new Date() },
      });
    }
    if (readings.length > 1) {
      this.logger.log(
        `attachment #${row.id}: ${readings.length} documents in one file`,
      );
    }
  }

  /**
   * step11b: the files these became — each id plus the sibling rows a multi-document file
   * was split into. Order: each original followed by its siblings.
   */
  async family(ids: number[]): Promise<number[]> {
    if (!ids.length) return [];
    const sibs = await this.prisma.transactionAttachment.findMany({
      where: {
        OR: ids.map((id) => ({ sourceRef: { startsWith: `doc:${id}:` } })),
        deletedAt: null,
      },
      select: { id: true, sourceRef: true },
      orderBy: { id: 'asc' },
    });
    const out: number[] = [];
    for (const id of ids) {
      out.push(id);
      for (const s of sibs)
        if (siblingOf(s.sourceRef)?.rowId === id) out.push(s.id);
    }
    return out;
  }

  /**
   * step11b: waits until none of these files is still being read (or `timeoutMs` passes), so
   * the assistant can answer knowing what each one turned out to be. Kicks the queue first.
   */
  async waitUntilRead(ids: number[], timeoutMs = 90_000): Promise<boolean> {
    if (!ids.length) return true;
    this.processSoon();
    const until = Date.now() + timeoutMs;
    for (;;) {
      const busy = await this.prisma.transactionAttachment.count({
        where: {
          id: { in: ids },
          deletedAt: null,
          status: {
            in: [AttachmentStatus.PENDING, AttachmentStatus.PROCESSING],
          },
        },
      });
      if (!busy) return true;
      if (Date.now() >= until) return false;
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }

  /**
   * A matched cheque names its row (user's request 2026-10-14): the bank prints "CHEQUE 123",
   * the cheque says who it was made out to. Only a row with no real name yet — none, or a
   * generic "Cheque…" — takes the payee, as a ONE-TIME edit (`manualEdit`, so "Always"
   * rules leave it). Its category is the payee's own (their rule, the firm memory, their
   * rows); for a payee new to them, what the cheque reader assumed from the payee and memo.
   * Nothing goes into the firm memory.
   */
  private async nameFromCheque(
    scope: BookScope,
    transactionId: number,
    reading: AttachmentReading,
  ): Promise<void> {
    const payee = cleanName(reading.payee);
    if (!payee) return;
    const tx = await this.prisma.bankTransaction.findFirst({
      where: { id: transactionId, ...scopeWhere(scope) },
      select: { name: true },
    });
    if (!tx || (tx.name && !GENERIC_CHEQUE_NAME.test(tx.name))) return;
    const known = await this.names.categoryOfName(scope, payee);
    await this.names.editTransaction(scope, transactionId, {
      name: payee,
      category: known ? null : (reading.category ?? null),
      scope: 'ONCE',
    });
  }

  private async recordFailure(
    row: TransactionAttachment,
    err: unknown,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = row.attempts + 1;
    const final =
      err instanceof UnreadableAttachmentError || attempts >= MAX_ATTEMPTS;
    this.logger.warn(
      `attachment #${row.id} attempt ${attempts} failed${final ? ' (final)' : ''}: ${message}`,
    );
    await this.prisma.transactionAttachment
      .update({
        where: { id: row.id },
        data: {
          attempts,
          status: final ? AttachmentStatus.FAILED : AttachmentStatus.PENDING,
          error: final
            ? err instanceof UnreadableAttachmentError
              ? message.slice(0, 512)
              : 'We could not read this file. Try again, or upload a clearer copy.'
            : null,
        },
      })
      .catch(() => undefined);
  }

  /** The transaction a reading belongs to, or null with the reason why not. */
  private async match(
    scope: BookScope,
    reading: AttachmentReading,
    message: string | null,
    /** Cut out of this statement (`StatementImagesService`): its own rows come first. */
    statementId: number | null = null,
  ): Promise<{ transactionId: number | null; note: string }> {
    const total = readingTotal(reading);
    if (total == null && !reading.date) {
      return {
        transactionId: null,
        note: 'No amount or date could be read, so choose the transaction yourself.',
      };
    }
    const q: MatchQuery = {
      kind:
        reading.kind === 'RECEIPT'
          ? 'RECEIPT'
          : reading.kind === 'CHECK'
            ? 'CHECK'
            : 'OTHER',
      date: reading.date,
      total,
    };
    // An image cut out of a statement belongs to one of THAT statement's rows when any
    // qualifies; otherwise (or for any other upload) every statement is searched.
    let list = statementId
      ? shortlist(q, await this.candidates(scope, q, statementId))
      : [];
    if (!list.length) list = shortlist(q, await this.candidates(scope, q));
    const byNumber = chequeNumberMatch(reading.checkNumber, total, list);
    if (byNumber) {
      return {
        transactionId: byNumber.id,
        note: `Matched by cheque number ${reading.checkNumber} (${byNumber.name ?? byNumber.description}).`,
      };
    }
    // A cheque cut out of a statement: that statement's one cheque row at its amount.
    const byAmount =
      statementId && q.kind === 'CHECK' ? chequeAmountMatch(total, list) : null;
    if (byAmount) {
      return {
        transactionId: byAmount.id,
        note: `Matched to the cheque of $${total!.toFixed(2)} on this statement (${byAmount.name ?? byAmount.description}).`,
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
    const obvious = obviousMatch(q, list);
    if (obvious) {
      return {
        transactionId: obvious.id,
        note: `Matched by amount and date (${obvious.name ?? obvious.description}).`,
      };
    }
    const top = list.slice(0, MAX_FOR_AI);
    const pick = await this.extractor.pick(
      reading,
      top,
      message,
      (await this.rules?.promptBlock(scope, 'MATCHING')) ?? '',
    );
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

  /**
   * step11 "Ask AI": a WIDER search than the automatic matcher, steered by what the customer
   * said ("it's the Amazon charge on Mar 3"). Every hint is optional; with none, the
   * reading's own amount (±25%) and date (±45 days) are used. DONE parent rows of this book
   * only, closest date first, at most `limit`.
   */
  async candidatesFor(
    scope: BookScope,
    attachmentId: number,
    hints: {
      from?: string | null;
      to?: string | null;
      amount?: number | null;
      text?: string | null;
    } = {},
    limit = 30,
  ): Promise<MatchCandidate[]> {
    const a = await this.prisma.transactionAttachment.findFirst({
      where: { id: attachmentId, ...scopeWhere(scope), deletedAt: null },
      select: { extracted: true },
    });
    if (!a) return [];
    const reading = (a.extracted ??
      null) as unknown as AttachmentReading | null;
    const amount = hints.amount ?? (reading ? readingTotal(reading) : null);
    const anchor = reading?.date ?? null;
    const dayMs = 86_400_000;
    const isDay = (d?: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
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
    const where: Prisma.BankTransactionWhereInput = {
      ...scopeWhere(scope),
      splitOfId: null,
      statement: { deletedAt: null, status: StatementStatus.DONE },
    };
    const and: Prisma.BankTransactionWhereInput[] = [];
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
    if (and.length) where.AND = and;
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
    const gap = (d: Date | null) =>
      at === null || !d ? Number.MAX_SAFE_INTEGER : Math.abs(d.getTime() - at);
    return rows
      .sort(
        (x, y) =>
          gap(x.postingDate ?? x.pendingDate) -
            gap(y.postingDate ?? y.pendingDate) || x.id - y.id,
      )
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

  /**
   * The customer's transactions in reach of the reading: DONE parent rows within the
   * date window, and — when an amount was read — in the amount band (either sign; the
   * shortlist decides the sign).
   */
  private async candidates(
    scope: BookScope,
    q: MatchQuery,
    statementId?: number,
  ): Promise<MatchCandidate[]> {
    const where: Prisma.BankTransactionWhereInput = {
      ...scopeWhere(scope),
      ...(statementId ? { statementId } : {}),
      splitOfId: null,
      statement: { deletedAt: null, status: StatementStatus.DONE },
    };
    if (q.total) {
      const lo = q.total.toFixed(2);
      const hi = (q.total * (1 + TIP_SLACK)).toFixed(2);
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
                gte: new Date(at - DAYS_BEFORE * 86_400_000),
                lte: new Date(at + DAYS_AFTER * 86_400_000),
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
          ? readingTotal(a.extracted as unknown as AttachmentReading)
          : null;
        return t ? [cents(t)] : [];
      }),
    }));
  }

  /**
   * Lay a receipt's items on its transaction as splits. With `replace` false (automatic)
   * a transaction that already has splits is left alone. Returns a sentence for the
   * customer when nothing was done, or null when the splits were made.
   */
  async applyItems(
    scope: BookScope,
    attachmentId: number,
    replace: boolean,
  ): Promise<string | null> {
    const a = await this.prisma.transactionAttachment.findFirst({
      where: { id: attachmentId, ...scopeWhere(scope), deletedAt: null },
      include: {
        transaction: {
          include: { splits: { select: { id: true }, take: 1 } },
        },
      },
    });
    const parent = a?.transaction;
    const reading = a?.extracted as unknown as AttachmentReading | null;
    if (!a || !parent || !reading) return 'Nothing to split yet.';
    // A purchase is split by its items whether it arrived as a photo, a voice note or a
    // text message ("tissues $10, pampers $40 at Walmart").
    const purchase =
      a.kind === AttachmentKind.RECEIPT || reading.kind === 'RECEIPT';
    if (!purchase || !reading.items?.length) {
      return purchase ? 'No items could be read off the receipt.' : null;
    }
    if (!replace && parent.splits.length) {
      return 'The transaction is already split; use "Use receipt items" to replace its splits.';
    }
    // The customer's rule, else the firm memory, else the AI (remembered), else the parent's.
    const categoryFor = await this.products.categoriesFor(
      scope,
      reading.items.map((i) => i.name),
      { store: reading.vendor, parentCategory: parent.offsetAccount },
    );
    const out = itemSplits(
      reading.items,
      reading.tax,
      Number(parent.amount),
      categoryFor,
    );
    if ('problem' in out) return `${out.problem}, so it was not split.`;
    await this.splits.save(
      scope,
      parent.id,
      out.splits.map((s) => ({
        name: parent.name,
        itemName: s.itemName,
        category: s.category,
        amount: s.amount,
      })),
    );
    return null;
  }
}
