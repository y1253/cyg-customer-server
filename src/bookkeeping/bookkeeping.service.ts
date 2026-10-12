import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StatementStatus, type BankStatement } from '@prisma/client';
import type { Readable } from 'stream';
import { OpenAiClient } from '../ai/openai.client';
import { readPricing } from '../billing/pricing';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { loadOpeningStatements } from './opening-balance.query';
import {
  ledgerOrder,
  OPENING_POSITION,
  openingRows,
} from './opening-balance.util';
import { statementLabel } from './statement-label';
import { StatementProcessorService } from './statement-processor.service';
import { TaxService } from './tax.service';
import { remainderOf, splitTotals } from './splits.util';
import type { StoredTax } from './tax.service';
import { taxSplit } from './tax.util';

export interface StatementView {
  id: number;
  filename: string;
  sizeBytes: number;
  status: StatementStatus;
  error: string | null;
  accountName: string | null;
  bankName: string | null;
  /** "Chase 4362 · Sep 2026" — what every ledger row of this statement shows. */
  label: string;
  periodStart: string | null;
  periodEnd: string | null;
  transactionCount: number;
  createdAt: Date;
  processedAt: Date | null;
}

export interface TransactionView {
  /**
   * Unique per row, the React key: `t:<transaction>`, `s:<split>`, `o:<statement>`,
   * `x:<tax line>`.
   */
  key: string;
  /**
   * The transaction's id; for a tax row, the id of the row it taxes (a transaction or a
   * split). 0 on a starting balance.
   */
  id: number;
  /** On a split, and on a split's tax rows: the transaction it was split from. */
  splitOfId?: number;
  statementId: number;
  pendingDate: string | null;
  postingDate: string | null;
  description: string;
  /** The payee / payer the AI read out of the description; null when it found none. */
  name: string | null;
  amount: number;
  offsetAccount: string;
  debitAccount: string;
  creditAccount: string;
  /** The statement it came from, e.g. "Chase 4362 · Sep 2026". */
  statementLabel: string;
  /**
   * `opening`: the statement's printed starting balance, offset to Owner's Loan — never
   * stored. `tax`: an agency's tax on the row just above it (`TransactionTax`), taken OUT
   * of that row: the row above shows its amount without tax, and the two add back to what
   * the bank moved. `split`: a part the customer split off the transaction above by hand,
   * with its own name, category and taxes; the transaction shows what is left of it.
   */
  kind?: 'opening' | 'tax' | 'split';
  /** On a tax row: the agency's rate, a percent. */
  taxRate?: number;
  /** On a tax row: the agency — the key for renaming the line. */
  taxAgencyId?: number;
}

const day = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/** A row without its tax, then one line per agency (named by the customer, or as the row). */
function withTaxLines(
  p: TransactionView,
  lines: StoredTax[] | undefined,
): TransactionView[] {
  if (!lines?.length) return [p];
  const split = taxSplit(p, lines);
  return [
    split.parent,
    ...split.taxes.map(
      (entry, i): TransactionView => ({
        ...p,
        ...entry,
        key: `x:${lines[i].id}`,
        name: lines[i].name ?? p.name,
        kind: 'tax',
        taxRate: lines[i].rate,
        taxAgencyId: lines[i].agencyId,
      }),
    ),
  ];
}

/**
 * What the customer sees of a statement. The check against the bank's figures
 * (`verification`, `verificationDetail`) is stored for us but deliberately NOT returned.
 */
function toView(s: BankStatement): StatementView {
  return {
    id: s.id,
    filename: s.filename,
    sizeBytes: s.sizeBytes,
    status: s.status,
    error: s.error,
    accountName: s.accountName,
    bankName: s.bankName,
    label: statementLabel(s),
    periodStart: day(s.periodStart),
    periodEnd: day(s.periodEnd),
    transactionCount: s.transactionCount,
    createdAt: s.createdAt,
    processedAt: s.processedAt,
  };
}

/**
 * A customer's statements and ledger. EVERY query is scoped to the caller's
 * `customerId`, and a statement that is not theirs answers 404 — never 403, which would
 * confirm somebody else's upload exists.
 */
@Injectable()
export class BookkeepingService {
  private readonly logger = new Logger(BookkeepingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly openai: OpenAiClient,
    private readonly processor: StatementProcessorService,
    private readonly tax: TaxService,
  ) {}

  /**
   * Stores each staged PDF in R2 as UPLOADED — NOT read yet: reading starts when the
   * customer clicks Generate (`generate`). Staged files are always removed.
   */
  async upload(
    customerId: number,
    files: Express.Multer.File[],
  ): Promise<StatementView[]> {
    try {
      if (!files?.length)
        throw new BadRequestException('Choose at least one PDF statement');
      if (!this.storage.configured || !this.openai.configured) {
        throw new ServiceUnavailableException(
          'Statement uploads are not available right now. Please try again later.',
        );
      }
      const created: StatementView[] = [];
      for (const file of files) {
        const key = `bookkeeping/${customerId}/${randomUUID()}.pdf`;
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
    } finally {
      await Promise.all(
        (files ?? []).map((f) => unlink(f.path).catch(() => undefined)),
      );
    }
  }

  /**
   * The customer's own `POST /bookkeeping/generate`: allowed only when it costs nothing —
   * the admin price is $0, or there are no new statements (a tax-only re-run is free).
   * A paid Generate goes through billing (`BillingService`), which calls `generate` itself
   * once the payment is recorded.
   */
  async generateIfFree(
    customerId: number,
  ): Promise<{ queued: number; taxing: boolean }> {
    const waiting = await this.waitingCount(customerId);
    if (waiting && (await readPricing(this.prisma)).generatePriceCents > 0)
      throw new HttpException(
        'Payment required — pay to read your new statements.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    return this.generate(customerId);
  }

  /** Statements uploaded but not read yet — what the next Generate would queue. */
  waitingCount(customerId: number): Promise<number> {
    return this.prisma.bankStatement.count({
      where: { customerId, deletedAt: null, status: StatementStatus.UPLOADED },
    });
  }

  /**
   * Generate: queue every UPLOADED statement for reading, and re-run the tax step over the
   * statements already read when the tax settings changed since the last run.
   */
  async generate(
    customerId: number,
  ): Promise<{ queued: number; taxing: boolean }> {
    const { count } = await this.prisma.bankStatement.updateMany({
      where: { customerId, deletedAt: null, status: StatementStatus.UPLOADED },
      data: { status: StatementStatus.PENDING },
    });
    if (count) this.processor.processSoon();
    const taxing =
      (await this.tax.needsRetag(customerId)) &&
      (await this.tax.retagCustomer(customerId));
    return { queued: count, taxing };
  }

  async list(customerId: number): Promise<StatementView[]> {
    const rows = await this.prisma.bankStatement.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  async transactions(
    customerId: number,
    statementIds?: number[],
  ): Promise<TransactionView[]> {
    const [rows, statements, taxes] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where: {
          customerId,
          ...(statementIds?.length && { statementId: { in: statementIds } }),
          statement: { deletedAt: null, status: StatementStatus.DONE },
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
      // ALL done statements: the chain decides which ones start fresh, even when the
      // ledger is filtered to a few of them.
      loadOpeningStatements(this.prisma, customerId),
      this.tax.linesFor(customerId, statementIds),
    ]);

    const byId = new Map(statements.map((s) => [s.id, s]));
    const totals = splitTotals(
      rows.map((r) => ({ splitOfId: r.splitOfId, amount: Number(r.amount) })),
    );
    const viewOf = (r: (typeof rows)[number]): TransactionView => ({
      key: r.splitOfId ? `s:${r.id}` : `t:${r.id}`,
      id: r.id,
      statementId: r.statementId,
      pendingDate: day(r.pendingDate),
      postingDate: day(r.postingDate),
      description: r.description,
      name: r.name,
      amount: remainderOf({ ...r, amount: Number(r.amount) }, totals),
      offsetAccount: r.offsetAccount,
      debitAccount: r.debitAccount,
      creditAccount: r.creditAccount,
      statementLabel: statementLabel(r.statement),
      ...(r.splitOfId && { splitOfId: r.splitOfId, kind: 'split' as const }),
    });
    const splitsOf = new Map<number, TransactionView[]>();
    for (const r of rows) {
      if (!r.splitOfId) continue;
      const list = splitsOf.get(r.splitOfId) ?? [];
      list.push(viewOf(r));
      splitsOf.set(r.splitOfId, list);
    }
    for (const list of splitsOf.values()) list.sort((a, b) => a.id - b.id);
    const wanted = statementIds?.length ? new Set(statementIds) : null;
    const openings = openingRows(statements).filter(
      (o) => !wanted || wanted.has(o.statementId),
    );

    const keyed: Array<{
      postingDate: Date | null;
      statementId: number;
      position: number;
      view: TransactionView;
    }> = [
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
        position: OPENING_POSITION,
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
          statementLabel: statementLabel(byId.get(o.statementId)!),
          kind: 'opening' as const,
        },
      })),
    ];
    // Newest first. A taxed row shows its amount without tax, its tax lines directly under
    // it; then its splits, each followed by its own tax lines.
    const sorted = keyed.sort((a, b) => -ledgerOrder(a, b)).map((k) => k.view);
    return sorted.flatMap((p): TransactionView[] =>
      p.kind
        ? [p]
        : [
            ...withTaxLines(p, taxes.get(p.id)),
            ...(splitsOf.get(p.id) ?? []).flatMap((c) =>
              withTaxLines(c, taxes.get(c.id)),
            ),
          ],
    );
  }

  async file(
    customerId: number,
    id: number,
  ): Promise<{ stream: Readable; filename: string; size: number }> {
    const s = await this.owned(customerId, id);
    const info = await this.storage.head(s.storageKey);
    if (!info)
      throw new NotFoundException('The original file is no longer available');
    return {
      stream: await this.storage.getStream(s.storageKey),
      filename: s.filename,
      size: info.size,
    };
  }

  async retry(customerId: number, id: number): Promise<StatementView> {
    const s = await this.owned(customerId, id);
    if (
      s.status !== StatementStatus.FAILED &&
      s.status !== StatementStatus.NEEDS_REVIEW
    ) {
      throw new BadRequestException(
        'Only a statement that failed can be retried',
      );
    }
    // A fresh set of full reads: "re-read until it matches" starts over.
    const row = await this.prisma.bankStatement.update({
      where: { id: s.id },
      data: {
        status: StatementStatus.PENDING,
        attempts: 0,
        runs: 0,
        error: null,
      },
    });
    this.processor.processSoon();
    return toView(row);
  }

  /** Soft delete: its rows leave the ledger at once; the PDF stays in R2. */
  async remove(customerId: number, id: number): Promise<void> {
    const s = await this.owned(customerId, id);
    await this.prisma.bankStatement.update({
      where: { id: s.id },
      data: { deletedAt: new Date() },
    });
  }

  private async owned(customerId: number, id: number): Promise<BankStatement> {
    const s = await this.prisma.bankStatement.findFirst({
      where: { id, customerId, deletedAt: null },
    });
    if (!s) throw new NotFoundException('Statement not found');
    return s;
  }
}
