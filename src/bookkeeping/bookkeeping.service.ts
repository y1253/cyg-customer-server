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
import { StatementProcessorService } from './statement-processor.service';

export interface StatementView {
  id: number;
  filename: string;
  sizeBytes: number;
  status: StatementStatus;
  error: string | null;
  accountName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  transactionCount: number;
  createdAt: Date;
  processedAt: Date | null;
}

export interface TransactionView {
  id: number;
  statementId: number;
  pendingDate: string | null;
  postingDate: string | null;
  description: string;
  amount: number;
  offsetAccount: string;
  debitAccount: string;
  creditAccount: string;
}

const day = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

function toView(s: BankStatement): StatementView {
  return {
    id: s.id,
    filename: s.filename,
    sizeBytes: s.sizeBytes,
    status: s.status,
    error: s.error,
    accountName: s.accountName,
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
  ) {}

  /** Stores each staged PDF in R2, queues it, and starts processing. Staged files are always removed. */
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
      this.processor.processSoon();
      return created;
    } finally {
      await Promise.all(
        (files ?? []).map((f) => unlink(f.path).catch(() => undefined)),
      );
    }
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
    const rows = await this.prisma.bankTransaction.findMany({
      where: {
        customerId,
        ...(statementIds?.length && { statementId: { in: statementIds } }),
        statement: { deletedAt: null, status: StatementStatus.DONE },
      },
      orderBy: [
        { postingDate: 'desc' },
        { statementId: 'desc' },
        { position: 'desc' },
      ],
    });
    return rows.map((r) => ({
      id: r.id,
      statementId: r.statementId,
      pendingDate: day(r.pendingDate),
      postingDate: day(r.postingDate),
      description: r.description,
      amount: Number(r.amount),
      offsetAccount: r.offsetAccount,
      debitAccount: r.debitAccount,
      creditAccount: r.creditAccount,
    }));
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
    if (s.status !== StatementStatus.FAILED) {
      throw new BadRequestException(
        'Only a statement that failed can be retried',
      );
    }
    const row = await this.prisma.bankStatement.update({
      where: { id: s.id },
      data: { status: StatementStatus.PENDING, attempts: 0, error: null },
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
