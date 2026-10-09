import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StatementStatus, type BankStatement } from '@prisma/client';
import type { Readable } from 'stream';
import { OpenAiClient } from '../ai/openai.client';
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
  /** Unique per row, the React key: `t:<transaction>`, `o:<statement>`, `x:<tax line>`. */
  key: string;
  /** The transaction's id; for a tax row, its PARENT transaction's id. 0 on a starting balance. */
  id: number;
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
   * stored. `tax`: an agency's tax on the row just above it (`TransactionTax`). Tax is
   * shown included: the row above is net of it, and the two add up to the bank amount.
   */
  kind?: 'opening' | 'tax';
  /** On a tax row: the agency's rate, a percent. */
  taxRate?: number;
}

const day = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

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
      ...rows.map((r) => ({
        postingDate: r.postingDate,
        statementId: r.statementId,
        position: r.position,
        view: {
          key: `t:${r.id}`,
          id: r.id,
          statementId: r.statementId,
          pendingDate: day(r.pendingDate),
          postingDate: day(r.postingDate),
          description: r.description,
          name: r.name,
          amount: Number(r.amount),
          offsetAccount: r.offsetAccount,
          debitAccount: r.debitAccount,
          creditAccount: r.creditAccount,
          statementLabel: statementLabel(r.statement),
        },
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
    // Newest first. A taxed row shows net of its tax, its tax lines directly under it.
    const sorted = keyed.sort((a, b) => -ledgerOrder(a, b)).map((k) => k.view);
    return sorted.flatMap((p): TransactionView[] => {
      const lines = p.kind ? undefined : taxes.get(p.id);
      if (!lines?.length) return [p];
      const split = taxSplit(p, lines);
      return [
        split.parent,
        ...split.taxes.map(
          (entry, i): TransactionView => ({
            ...p,
            ...entry,
            key: `x:${lines[i].id}`,
            kind: 'tax',
            taxRate: lines[i].rate,
          }),
        ),
      ];
    });
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
