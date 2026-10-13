import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AttachmentKind,
  AttachmentStatus,
  StatementStatus,
  type Prisma,
} from '@prisma/client';
import type { Readable } from 'stream';
import { OpenAiClient } from '../ai/openai.client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import type { AttachmentReading } from './attachment-extractor';
import {
  AttachmentProcessorService,
  readingTotal,
} from './attachment-processor.service';
import { attachmentType } from './attachment-uploads';
import { statementLabel } from './statement-label';

export interface AttachmentView {
  id: number;
  kind: AttachmentKind;
  status: AttachmentStatus;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  /** What the AI read; null until it has. */
  reading: AttachmentReading | null;
  /** The total the matching used (total, or subtotal + tax). */
  total: number | null;
  matchNote: string | null;
  error: string | null;
  /** UPLOAD (the site) or SMS (texted to an intake number). */
  source: string;
  /** SMS only: who sent it, and what they wrote. */
  sourcePhone: string | null;
  message: string | null;
  /** The transaction it belongs to; null while unmatched. */
  transaction: {
    id: number;
    name: string | null;
    description: string;
    amount: number;
    date: string | null;
    statementId: number;
    statementLabel: string;
    splitCount: number;
  } | null;
}

export interface IntakeView {
  /** E.164, oldest first. Empty when the firm has connected none. */
  numbers: string[];
  /** The customer's phone as texts are matched (E.164); null = no usable phone saved. */
  phone: string | null;
  /** A phone is saved but could not be read as a number (texts will not match). */
  phoneSaved: boolean;
}

const INCLUDE = {
  transaction: {
    include: {
      statement: {
        select: {
          accountName: true,
          bankName: true,
          filename: true,
          periodStart: true,
          periodEnd: true,
          deletedAt: true,
          status: true,
        },
      },
      _count: { select: { splits: true } },
    },
  },
} satisfies Prisma.TransactionAttachmentInclude;

type Loaded = Prisma.TransactionAttachmentGetPayload<{
  include: typeof INCLUDE;
}>;

const day = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

function toView(a: Loaded): AttachmentView {
  const reading = (a.extracted as unknown as AttachmentReading | null) ?? null;
  const t = a.transaction;
  // A transaction whose statement was deleted is gone from the ledger: show it unmatched.
  const live =
    t && !t.statement.deletedAt && t.statement.status === StatementStatus.DONE;
  return {
    id: a.id,
    kind: a.kind,
    status: a.status,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    createdAt: a.createdAt,
    reading,
    total: reading ? readingTotal(reading) : null,
    matchNote: a.matchNote,
    error: a.error,
    source: a.source,
    sourcePhone: a.sourcePhone,
    message: a.message,
    transaction: live
      ? {
          id: t.id,
          name: t.name,
          description: t.description,
          amount: Number(t.amount),
          date: day(t.postingDate ?? t.pendingDate),
          statementId: t.statementId,
          statementLabel: statementLabel(t.statement),
          splitCount: t._count.splits,
        }
      : null,
  };
}

/**
 * A customer's attachments: receipts, cheques and voice notes linked to ledger
 * transactions. Every query is scoped to `customerId`; someone else's attachment is a 404.
 * Reading and matching happen in `AttachmentProcessorService`.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly openai: OpenAiClient,
    private readonly processor: AttachmentProcessorService,
  ) {}

  /**
   * Stores each staged file in R2 and queues it for reading (free — no Generate needed).
   * With `transactionId` the files belong to that transaction and skip matching.
   */
  async upload(
    customerId: number,
    files: Express.Multer.File[],
    transactionId: number | null,
  ): Promise<AttachmentView[]> {
    try {
      if (!files?.length) throw new BadRequestException('Choose a file to add');
      if (!this.storage.configured || !this.openai.configured) {
        throw new ServiceUnavailableException(
          'Attachments are not available right now. Please try again later.',
        );
      }
      if (transactionId != null) await this.parent(customerId, transactionId);
      const ids: number[] = [];
      for (const file of files) {
        const type = attachmentType(file.originalname);
        if (!type) continue; // the upload filter already refused it
        const key = `bookkeeping/${customerId}/attachments/${randomUUID()}${type.ext}`;
        await this.storage.putFile(key, file.path, type.mime);
        const row = await this.prisma.transactionAttachment.create({
          data: {
            customerId,
            transactionId,
            kind:
              type.cls === 'audio'
                ? AttachmentKind.AUDIO
                : AttachmentKind.OTHER,
            filename: file.originalname.slice(0, 255),
            mimeType: type.mime,
            size: file.size,
            storageKey: key,
          },
          select: { id: true },
        });
        ids.push(row.id);
      }
      this.processor.processSoon();
      const rows = await this.prisma.transactionAttachment.findMany({
        where: { id: { in: ids } },
        include: INCLUDE,
        orderBy: { id: 'desc' },
      });
      return rows.map(toView);
    } finally {
      await Promise.all(
        (files ?? []).map((f) => unlink(f.path).catch(() => undefined)),
      );
    }
  }

  /**
   * The numbers customers text receipts to (every active `IntakeNumber`, bought in the
   * internal app) and whether a text from this customer would find them: it is matched on
   * the phone saved on their account, normalized (`phoneE164`).
   */
  async intake(customerId: number): Promise<IntakeView> {
    const [numbers, me] = await Promise.all([
      this.prisma.intakeNumber.findMany({
        where: { releasedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { phoneNumber: true },
      }),
      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { phone: true, phoneE164: true },
      }),
    ]);
    return {
      numbers: numbers.map((n) => n.phoneNumber),
      phone: me?.phoneE164 ?? null,
      phoneSaved: !!me?.phone,
    };
  }

  async list(customerId: number): Promise<AttachmentView[]> {
    const rows = await this.prisma.transactionAttachment.findMany({
      where: { customerId, deletedAt: null },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toView);
  }

  async get(customerId: number, id: number): Promise<AttachmentView> {
    return toView(await this.owned(customerId, id));
  }

  /**
   * Attach to a transaction by hand (a receipt's items are split onto it when it has no
   * splits yet), or detach with `null`. Splits already made from it are kept.
   */
  async setTransaction(
    customerId: number,
    id: number,
    transactionId: number | null,
  ): Promise<AttachmentView> {
    const a = await this.owned(customerId, id);
    if (
      a.status === AttachmentStatus.PENDING ||
      a.status === AttachmentStatus.PROCESSING
    ) {
      throw new BadRequestException(
        'This file is still being read. Try again in a moment.',
      );
    }
    if (transactionId == null) {
      await this.prisma.transactionAttachment.update({
        where: { id: a.id },
        data: {
          transactionId: null,
          status: AttachmentStatus.UNMATCHED,
          matchNote: 'Removed from its transaction by you.',
        },
      });
      return this.get(customerId, id);
    }
    await this.parent(customerId, transactionId);
    await this.prisma.transactionAttachment.update({
      where: { id: a.id },
      data: {
        transactionId,
        status: a.extracted ? AttachmentStatus.MATCHED : a.status,
        matchNote: 'Attached by you.',
      },
    });
    if (a.extracted) {
      const note = await this.processor.applyItems(customerId, a.id, false);
      if (note) {
        await this.prisma.transactionAttachment.update({
          where: { id: a.id },
          data: { matchNote: `Attached by you. ${note}`.slice(0, 512) },
        });
      }
    }
    return this.get(customerId, id);
  }

  /** Replace the transaction's splits with the receipt's items. */
  async applyItems(customerId: number, id: number): Promise<AttachmentView> {
    const a = await this.owned(customerId, id);
    if (!a.transactionId) {
      throw new BadRequestException(
        'Attach the receipt to a transaction first',
      );
    }
    const note = await this.processor.applyItems(customerId, a.id, true);
    if (note) throw new BadRequestException(note);
    return this.get(customerId, id);
  }

  async retry(customerId: number, id: number): Promise<AttachmentView> {
    const a = await this.owned(customerId, id);
    if (
      a.status !== AttachmentStatus.FAILED &&
      a.status !== AttachmentStatus.UNMATCHED
    ) {
      throw new BadRequestException(
        'Only a file that failed or found no match can be read again',
      );
    }
    await this.prisma.transactionAttachment.update({
      where: { id: a.id },
      data: { status: AttachmentStatus.PENDING, attempts: 0, error: null },
    });
    this.processor.processSoon();
    return this.get(customerId, id);
  }

  /** Soft delete; the file stays in R2 and any splits made from it stay too. */
  async remove(customerId: number, id: number): Promise<void> {
    const a = await this.owned(customerId, id);
    await this.prisma.transactionAttachment.update({
      where: { id: a.id },
      data: { deletedAt: new Date() },
    });
  }

  async file(
    customerId: number,
    id: number,
  ): Promise<{
    stream: Readable;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    const a = await this.owned(customerId, id);
    const info = await this.storage.head(a.storageKey);
    if (!info) throw new NotFoundException('The file is no longer available');
    return {
      stream: await this.storage.getStream(a.storageKey),
      filename: a.filename,
      mimeType: a.mimeType,
      size: info.size,
    };
  }

  /** Attachment summaries per parent transaction, for the ledger. */
  async byTransaction(
    customerId: number,
    transactionIds: number[],
  ): Promise<
    Map<number, Array<{ id: number; kind: AttachmentKind; filename: string }>>
  > {
    const out = new Map<
      number,
      Array<{ id: number; kind: AttachmentKind; filename: string }>
    >();
    if (!transactionIds.length) return out;
    const rows = await this.prisma.transactionAttachment.findMany({
      where: {
        customerId,
        deletedAt: null,
        transactionId: { in: transactionIds },
      },
      select: { id: true, kind: true, filename: true, transactionId: true },
      orderBy: { id: 'asc' },
    });
    for (const r of rows) {
      const list = out.get(r.transactionId!) ?? [];
      list.push({ id: r.id, kind: r.kind, filename: r.filename });
      out.set(r.transactionId!, list);
    }
    return out;
  }

  private async owned(customerId: number, id: number): Promise<Loaded> {
    const a = await this.prisma.transactionAttachment.findFirst({
      where: { id, customerId, deletedAt: null },
      include: INCLUDE,
    });
    if (!a) throw new NotFoundException('Attachment not found');
    return a;
  }

  /** A transaction an attachment may hang on: theirs, read, and not itself a split. */
  private async parent(customerId: number, id: number): Promise<void> {
    const t = await this.prisma.bankTransaction.findFirst({
      where: {
        id,
        customerId,
        statement: { deletedAt: null, status: StatementStatus.DONE },
      },
      select: { splitOfId: true },
    });
    if (!t) throw new NotFoundException('Transaction not found');
    if (t.splitOfId) {
      throw new BadRequestException(
        'Add the file to the transaction this split came from.',
      );
    }
  }
}
