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
import { Readable } from 'stream';
import { OpenAiClient } from '../ai/openai.client';
import { changeFeed } from '../assistant/change-feed';
import { firmReach } from '../messaging/reach';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import type { AttachmentReading } from './attachment-extractor';
import {
  AttachmentProcessorService,
  readingTotal,
  siblingOf,
  sniffImageMime,
} from './attachment-processor.service';
import { attachmentFolder } from './attachment-folders.util';
import {
  attachmentName,
  fileBucket,
  type FileBucket,
} from './attachment-name.util';
import { attachmentType } from './attachment-uploads';
import { scopeWhere, storagePrefix, type BookScope } from './scope';
import { statementLabel } from './statement-label';
import { chequeNumberOf } from './cheque-caption.util';
import { statementOf } from './attachment-match.util';

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
  /**
   * step8 (2026-11-11): the statement this file was cut out of (a cheque image) — its
   * "from statement" badge opens that statement's PDF. Null for every other file.
   */
  fromStatementId: number | null;
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
  /**
   * step9: this file was cut out of a bigger image holding several documents (two cheques
   * side by side) — `GET attachments/:id/file?original=1` gives the whole image.
   */
  cropped: boolean;
  /** step9: the other documents read off the same image (`doc:<row>:<n>` rows), by id. */
  siblings: number[];
  /**
   * step2 (2026-11-11): the Names-tab name it is filed under (`attachmentName`) — null =
   * Unsorted — and which of the three counts it is in.
   */
  name: string | null;
  bucket: FileBucket;
  /** step2: the customer's subfolder inside that name's folder; null = the top. */
  folderId: number | null;
  /** step2: the customer's own name for the file; null = not renamed. */
  displayName: string | null;
  /** step2: it came by email and the email is kept — "View full email". */
  hasEmail: boolean;
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

/** A name a file is filed under, as typed; '' / blank = none. */
export const cleanName = (s: string | null | undefined): string | null =>
  s?.replace(/\s+/g, ' ').trim().slice(0, 191) || null;

const day = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/**
 * step8: a document cut from a statement image (`doc:<row>:<n>`) gets the statement of the
 * row it was cut from — `rows` = the rows at hand (the book's, or the file's group).
 */
function withSourceStatements(
  views: AttachmentView[],
  rows: ReadonlyArray<{ id: number; sourceRef: string | null }>,
): AttachmentView[] {
  const refOf = new Map(rows.map((r) => [r.id, r.sourceRef]));
  return views.map((v) => {
    if (v.fromStatementId !== null) return v;
    let ref = refOf.get(v.id) ?? null;
    for (let i = 0; i < 3 && ref?.startsWith('doc:'); i++) {
      ref = refOf.get(Number(ref.split(':')[1])) ?? null;
    }
    const id = statementOf(ref);
    return id === null ? v : { ...v, fromStatementId: id };
  });
}

function toView(a: Loaded, messageCount = 0): AttachmentView {
  const reading = (a.extracted as unknown as AttachmentReading | null) ?? null;
  const t = a.transaction;
  // A transaction whose statement was deleted is gone from the ledger: show it unmatched.
  const live =
    t && !t.statement.deletedAt && t.statement.status === StatementStatus.DONE;
  return {
    id: a.id,
    fromStatementId: statementOf(a.sourceRef),
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
    cropped: !!a.sourceStorageKey,
    siblings: [],
    ...placeOf(a, reading, live ? t : null),
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

/** step2: where a file sits on the Names tab, and which count it is in. */
function placeOf(
  a: Loaded,
  reading: AttachmentReading | null,
  t: { name: string | null } | null,
): Pick<
  AttachmentView,
  'name' | 'bucket' | 'folderId' | 'displayName' | 'hasEmail'
> {
  const name = attachmentName({
    nameOverride: a.nameOverride,
    transaction: t,
    reading,
  });
  return {
    name,
    bucket: fileBucket(a.status, !!t, name == null),
    folderId: a.folderId,
    displayName: a.displayName,
    hasEmail: a.inboxMessageId != null || a.source === 'EMAIL',
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
    /**
     * step2: uploaded inside a name's folder on the Names tab (and maybe one of its
     * subfolders) — it stays there; it is still read and matched like any file.
     */
    place: { name?: string | null; folderId?: number | null } = {},
  ): Promise<AttachmentView[]> {
    try {
      if (!files?.length) throw new BadRequestException('Choose a file to add');
      if (!this.storage.configured || !this.openai.configured) {
        throw new ServiceUnavailableException(
          'Attachments are not available right now. Please try again later.',
        );
      }
      if (transactionId != null) await this.parent(scope, transactionId);
      const folderId =
        place.folderId != null
          ? (await this.folder(scope, place.folderId)).id
          : null;
      const nameOverride = cleanName(place.name);
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
            nameOverride,
            folderId,
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
    return withSourceStatements(
      rows.map((r) => toView(r, counts.get(r.id) ?? 0)),
      rows,
    );
  }

  async get(scope: BookScope, id: number): Promise<AttachmentView> {
    const row = await this.owned(scope, id);
    const counts = await this.messageCounts(scope, [row.id]);
    const group = await this.groupOf(scope, row);
    const [view] = withSourceStatements(
      [toView(row, counts.get(row.id) ?? 0)],
      group,
    );
    return {
      ...view,
      siblings: group.filter((x) => x.id !== row.id).map((x) => x.id),
    };
  }

  /**
   * step9: every row read off the same file — the original row and its `doc:<row>:<n>`
   * siblings (two cheques in one image are two rows). Live rows only.
   */
  private async groupOf(
    scope: BookScope,
    row: { id: number; sourceRef: string | null },
  ): Promise<
    Array<{
      id: number;
      transactionId: number | null;
      sourceRef: string | null;
    }>
  > {
    const rootId = siblingOf(row.sourceRef)?.rowId ?? row.id;
    return this.prisma.transactionAttachment.findMany({
      where: {
        ...scopeWhere(scope),
        deletedAt: null,
        OR: [{ id: rootId }, { sourceRef: { startsWith: `doc:${rootId}:` } }],
      },
      select: { id: true, transactionId: true, sourceRef: true },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * step9: read a file again from scratch — also one that is MATCHED (the customer says it
   * was read or attached wrong, or two cheques were filed as one). The file and every other
   * document read off it are taken off their transactions and read again, cut into one file
   * per document when the image holds several; `note` (what the customer said is wrong) is
   * given to the reader. Splits already made from it stay.
   */
  async reread(
    scope: BookScope,
    id: number,
    note?: string,
  ): Promise<AttachmentView> {
    const a = await this.owned(scope, id);
    if (
      a.status === AttachmentStatus.PENDING ||
      a.status === AttachmentStatus.PROCESSING
    ) {
      throw new BadRequestException('This file is being read right now');
    }
    const group = await this.groupOf(scope, a);
    const rootId = siblingOf(a.sourceRef)?.rowId ?? a.id;
    const root = group.find((x) => x.id === rootId) ?? { id: a.id };
    const text = note?.trim().slice(0, 1000) || null;
    await this.prisma.$transaction([
      // The others are filed again by the original's read (`fileSiblings`).
      this.prisma.transactionAttachment.updateMany({
        where: {
          id: { in: group.map((x) => x.id).filter((x) => x !== root.id) },
        },
        data: {
          transactionId: null,
          status: AttachmentStatus.UNMATCHED,
          matchNote: 'Being read again.',
        },
      }),
      this.prisma.transactionAttachment.update({
        where: { id: root.id },
        data: {
          transactionId: null,
          status: AttachmentStatus.PENDING,
          attempts: 0,
          error: null,
          // The customer's correction rides along until the read is done (`processOne`).
          ...(text && {
            extracted: {
              ...((await this.readingOf(root.id)) ?? {}),
              customerNote: text,
            } as Prisma.InputJsonValue,
          }),
        },
      }),
    ]);
    this.processor.processSoon();
    return this.get(scope, root.id);
  }

  private async readingOf(id: number): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.transactionAttachment.findUnique({
      where: { id },
      select: { extracted: true },
    });
    const e = row?.extracted;
    return e && typeof e === 'object' && !Array.isArray(e)
      ? (e as Record<string, unknown>)
      : null;
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
  /**
   * step8 (2026-11-11): why a cheque must NOT be moved to `transactionId` — it is already on
   * the row printing its cheque number (`chequeNumberOf`), and the target does not print it.
   * Null = moving it is fine.
   */
  async chequeKeptOn(
    scope: BookScope,
    id: number,
    transactionId: number,
  ): Promise<string | null> {
    const row = await this.prisma.transactionAttachment.findFirst({
      where: { id, ...scopeWhere(scope), deletedAt: null },
      select: {
        transactionId: true,
        extracted: true,
        transaction: { select: { description: true } },
      },
    });
    if (!row?.transaction || row.transactionId === transactionId) return null;
    const e = (row.extracted ?? {}) as { checkNumber?: unknown };
    const wanted =
      typeof e.checkNumber === 'string'
        ? e.checkNumber.replace(/\D/g, '').replace(/^0+/, '')
        : '';
    if (!wanted || chequeNumberOf(row.transaction.description) !== wanted) {
      return null;
    }
    const target = await this.prisma.bankTransaction.findFirst({
      where: { id: transactionId, ...scopeWhere(scope) },
      select: { description: true },
    });
    if (target && chequeNumberOf(target.description) === wanted) return null;
    return `Not moved: this is cheque ${e.checkNumber as string} and it is already on "${row.transaction.description}", the transaction printing that number. Tell the customer; move it only if they say it is wrong (customerSaysWrong=true).`;
  }

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

  /**
   * 2026-11-11 (user's request): "Read all again" — every FAILED / UNMATCHED file of `ids`
   * in this book back to PENDING, as `retry` does one.
   */
  async retryAll(scope: BookScope, ids: number[]): Promise<{ queued: number }> {
    if (!ids.length) return { queued: 0 };
    const { count } = await this.prisma.transactionAttachment.updateMany({
      where: {
        id: { in: ids },
        ...scopeWhere(scope),
        deletedAt: null,
        status: { in: [AttachmentStatus.FAILED, AttachmentStatus.UNMATCHED] },
      },
      data: { status: AttachmentStatus.PENDING, attempts: 0, error: null },
    });
    if (count) {
      this.processor.processSoon();
      changeFeed.bump(scope.customerId);
    }
    return { queued: count };
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

  /**
   * step2 (2026-11-11): file it under another name (`name` '' = back to what was read),
   * into a subfolder (`folderId` null = the name's top), and/or give it its own name
   * (`displayName` '' = the original). Moving to another name leaves the subfolder.
   */
  async place(
    scope: BookScope,
    id: number,
    p: {
      name?: string | null;
      folderId?: number | null;
      displayName?: string | null;
    },
  ): Promise<AttachmentView> {
    const a = await this.owned(scope, id);
    const data: Prisma.TransactionAttachmentUncheckedUpdateInput = {};
    if (p.name !== undefined) {
      data.nameOverride = cleanName(p.name);
      if (p.folderId === undefined) data.folderId = null;
    }
    if (p.folderId !== undefined) {
      data.folderId =
        p.folderId == null ? null : (await this.folder(scope, p.folderId)).id;
    }
    if (p.displayName !== undefined) {
      data.displayName = p.displayName?.trim().slice(0, 255) || null;
    }
    await this.prisma.transactionAttachment.update({
      where: { id: a.id },
      data,
    });
    return this.get(scope, id);
  }

  /** A live subfolder of this book; 404 otherwise. */
  private async folder(scope: BookScope, id: number) {
    const f = await this.prisma.nameFolder.findFirst({
      where: { id, ...scopeWhere(scope), deletedAt: null },
      select: { id: true },
    });
    if (!f) throw new NotFoundException('Folder not found');
    return f;
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
    /** step9: the whole image a cropped file was cut out of. */
    original = false,
  ): Promise<{
    stream: Readable;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    const a = await this.owned(scope, id);
    const key = (original && a.sourceStorageKey) || a.storageKey;
    const info = await this.storage.head(key);
    if (!info) throw new NotFoundException('The file is no longer available');
    if (key !== a.storageKey) {
      // The uncut original keeps its own type (the crops are PNG).
      const head = await this.storage.getBuffer(key);
      return {
        stream: Readable.from(head),
        filename: `whole image - ${a.filename}`,
        mimeType: sniffImageMime(head) ?? 'application/octet-stream',
        size: head.length,
      };
    }
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
