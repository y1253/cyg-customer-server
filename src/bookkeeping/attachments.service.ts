import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AttachmentKind,
  AttachmentStatus,
  StatementStatus,
  type Prisma,
} from '@prisma/client';
import type { Readable } from 'stream';
import { OpenAiClient } from '../ai/openai.client';
import { firmReach } from '../messaging/reach';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import type { AttachmentReading } from './attachment-extractor';
import {
  AttachmentProcessorService,
  readingTotal,
} from './attachment-processor.service';
import { attachmentFolder } from './attachment-folders.util';
import { attachmentType } from './attachment-uploads';
import { scopeWhere, storagePrefix, type BookScope } from './scope';
import { statementLabel } from './statement-label';

/**
 * step12: a voice note that was only a message (`kind AUDIO` read as a DOCUMENT — no
 * payment in it) is not a file: the assistant answered its words, and it lives in the
 * Communication tab's chat with its recording, never on the Attachments tab.
 */
export const NOT_VOICE_MESSAGE = {
  NOT: { kind: AttachmentKind.AUDIO, status: AttachmentStatus.DOCUMENT },
};

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
  /**
   * The bank-account folder it is filed under on the Attachments tab: its transaction's
   * statement account. Null = not matched yet (`attachment-folders.util.ts`).
   */
  folder: string | null;
  /**
   * step11b: AI messages linked to this file (sent with it, its "Ask AI" chat, the
   * assistant changing it) — the Attachments tab shows the conversation when > 0.
   */
  messageCount: number;
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
  /**
   * The subset that ALSO takes WhatsApp (an admin turned it on, and Meta verified it). A
   * number still takes texts either way — WhatsApp is an extra channel, never a swap.
   */
  whatsapp: string[];
  /** The customer's phone as texts are matched (E.164); null = no usable phone saved. */
  phone: string | null;
  /** A phone is saved but could not be read as a number (texts will not match). */
  phoneSaved: boolean;
  /** The customer inbox (step12): where they can EMAIL receipts and questions; null = none connected. */
  email: string | null;
  /** step12c: calling a receipt number reaches the AI assistant right now. */
  voice: boolean;
}

const INCLUDE = {
  transaction: {
    include: {
      statement: {
        select: {
          accountName: true,
          accountNameByCustomer: true,
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

function toView(a: Loaded, messageCount = 0): AttachmentView {
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
    folder: attachmentFolder(live ? t : null),
    messageCount,
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
 * transactions. Every query is scoped to ONE book (`scopeWhere`): the customer's general
 * tool or one of their companies. Another book's attachment is a 404.
 * Reading and matching happen in `AttachmentProcessorService`.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly openai: OpenAiClient,
    private readonly processor: AttachmentProcessorService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /**
   * Stores each staged file in R2 and queues it for reading (free — no Generate needed).
   * With `transactionId` the files belong to that transaction and skip matching.
   */
  async upload(
    scope: BookScope,
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
      if (transactionId != null) await this.parent(scope, transactionId);
      const ids: number[] = [];
      for (const file of files) {
        const type = attachmentType(file.originalname);
        if (!type) continue; // the upload filter already refused it
        const key = `${storagePrefix(scope)}/attachments/${randomUUID()}${type.ext}`;
        await this.storage.putFile(key, file.path, type.mime);
        const row = await this.prisma.transactionAttachment.create({
          data: {
            ...scopeWhere(scope),
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
      return rows.map((r) => toView(r));
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
  /**
   * About the CUSTOMER's phone, not a book: texted receipts always land in the general
   * book (a text cannot say which company it is for). Takes the scope only to stay uniform.
   */
  async intake(scope: BookScope): Promise<IntakeView> {
    const [reach, me] = await Promise.all([
      this.config ? firmReach(this.prisma, this.config) : Promise.resolve(null),
      this.prisma.customer.findUnique({
        where: { id: scope.customerId },
        select: { phone: true, phoneE164: true },
      }),
    ]);
    return {
      numbers: reach?.numbers ?? [],
      whatsapp: reach?.whatsapp ?? [],
      phone: me?.phoneE164 ?? null,
      phoneSaved: !!me?.phone,
      email: reach?.email ?? null,
      voice: reach?.voice ?? false,
    };
  }

  async list(scope: BookScope): Promise<AttachmentView[]> {
    const rows = await this.prisma.transactionAttachment.findMany({
      where: { ...scopeWhere(scope), deletedAt: null, ...NOT_VOICE_MESSAGE },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const counts = await this.messageCounts(
      scope,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toView(r, counts.get(r.id) ?? 0));
  }

  async get(scope: BookScope, id: number): Promise<AttachmentView> {
    const row = await this.owned(scope, id);
    const counts = await this.messageCounts(scope, [row.id]);
    return toView(row, counts.get(row.id) ?? 0);
  }

  /** step11b: how many AI messages each attachment is linked to. Never fails the list. */
  private async messageCounts(
    scope: BookScope,
    ids: number[],
  ): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (!ids.length) return out;
    try {
      const rows = await this.prisma.aiMessageAttachment.groupBy({
        by: ['attachmentId'],
        where: { ...scopeWhere(scope), attachmentId: { in: ids } },
        _count: { _all: true },
      });
      for (const r of rows) out.set(r.attachmentId, r._count._all);
    } catch {
      // the badge is a convenience; the list still loads
    }
    return out;
  }

  /**
   * Attach to a transaction by hand (a receipt's items are split onto it when it has no
   * splits yet), or detach with `null`. Splits already made from it are kept.
   */
  async setTransaction(
    scope: BookScope,
    id: number,
    transactionId: number | null,
  ): Promise<AttachmentView> {
    const a = await this.owned(scope, id);
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
      return this.get(scope, id);
    }
    await this.parent(scope, transactionId);
    await this.prisma.transactionAttachment.update({
      where: { id: a.id },
      data: {
        transactionId,
        status: a.extracted ? AttachmentStatus.MATCHED : a.status,
        matchNote: 'Attached by you.',
      },
    });
    if (a.extracted) {
      const note = await this.processor.applyItems(scope, a.id, false);
      if (note) {
        await this.prisma.transactionAttachment.update({
          where: { id: a.id },
          data: { matchNote: `Attached by you. ${note}`.slice(0, 512) },
        });
      }
    }
    return this.get(scope, id);
  }

  /** Replace the transaction's splits with the receipt's items. */
  async applyItems(scope: BookScope, id: number): Promise<AttachmentView> {
    const a = await this.owned(scope, id);
    if (!a.transactionId) {
      throw new BadRequestException(
        'Attach the receipt to a transaction first',
      );
    }
    const note = await this.processor.applyItems(scope, a.id, true);
    if (note) throw new BadRequestException(note);
    return this.get(scope, id);
  }

  async retry(scope: BookScope, id: number): Promise<AttachmentView> {
    const a = await this.owned(scope, id);
    if (
      a.status !== AttachmentStatus.FAILED &&
      a.status !== AttachmentStatus.UNMATCHED &&
      a.status !== AttachmentStatus.DOCUMENT
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
    return this.get(scope, id);
  }

  /** Soft delete; the file stays in R2 and any splits made from it stay too. */
  async remove(scope: BookScope, id: number): Promise<void> {
    const a = await this.owned(scope, id);
    await this.prisma.transactionAttachment.update({
      where: { id: a.id },
      data: { deletedAt: new Date() },
    });
  }

  async file(
    scope: BookScope,
    id: number,
  ): Promise<{
    stream: Readable;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    const a = await this.owned(scope, id);
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
    scope: BookScope,
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
        ...scopeWhere(scope),
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

  private async owned(scope: BookScope, id: number): Promise<Loaded> {
    const a = await this.prisma.transactionAttachment.findFirst({
      where: { id, ...scopeWhere(scope), deletedAt: null },
      include: INCLUDE,
    });
    if (!a) throw new NotFoundException('Attachment not found');
    return a;
  }

  /** A transaction an attachment may hang on: theirs, read, and not itself a split. */
  private async parent(scope: BookScope, id: number): Promise<void> {
    const t = await this.prisma.bankTransaction.findFirst({
      where: {
        id,
        ...scopeWhere(scope),
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
