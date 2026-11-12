import { randomUUID } from 'crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { AttachmentStatus, Prisma, type BankStatement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { statementImageRef } from './attachment-match.util';
import { AttachmentProcessorService } from './attachment-processor.service';
import { itemImages, type ImagePage, type ItemImage } from './pdf-images';
import { DocumentPipeline } from './pipeline/document-pipeline';
import { looksLikeChequeBack, looksLikeChequeText } from './pipeline/ocr.util';
import { scopeOf, scopeWhere, storagePrefix, type BookScope } from './scope';
import { statementLabel } from './statement-label';

export const STATEMENT_SOURCE = 'STATEMENT';

/**
 * Cheque / deposit-slip images printed in a statement (whole pages of them at the end, or
 * some under the rows) become attachments on the rows they belong to — the same as a
 * cheque the customer uploads on the Receipts tab, so the same reader reads them and the
 * same matcher (`AttachmentProcessorService`, which tries THIS statement's rows first)
 * places them. What it cannot place waits on the Receipts tab for the customer.
 *
 * Each image is one `TransactionAttachment` with `source = 'STATEMENT'`, keyed by
 * `sourceRef = stmt:<statementId>:p<page>:<n>`: a re-read statement re-queues the same
 * rows (and overwrites the same R2 objects) instead of adding twins, and images a re-read
 * no longer finds are removed. Free, like every attachment.
 */
@Injectable()
export class StatementImagesService {
  private readonly logger = new Logger(StatementImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly attachments: AttachmentProcessorService,
    /** step2 (2026-11-12): OCR, to tell a cheque from a summary box. Optional for specs. */
    @Optional() private readonly pipeline?: DocumentPipeline,
  ) {}

  /**
   * step2 (2026-11-12): only a cheque or a deposit slip becomes an attachment. Amex draws its
   * summary boxes as images; 37 of them ("Contact information…", "Payments and Credits") sat
   * in book 129 as documents. Captioned by the bank as a cheque = yes; else the OCR must read
   * cheque wording, a MICR line, a cheque's back or a deposit slip. No OCR = kept (as before).
   */
  private async isChequeLike(image: ItemImage): Promise<boolean> {
    if (image.caption?.number) return true;
    const ocr = await this.pipeline?.readImage(image.png).catch(() => null);
    if (!ocr) return true;
    return (
      looksLikeChequeText(ocr) ||
      looksLikeChequeBack(ocr) ||
      /(?<![\p{L}])(deposit|d[ée]p[ôo]t)(?![\p{L}])/iu.test(ocr.text)
    );
  }

  /** Never throws — a statement is done whether or not its images could be cut out. */
  async harvest(
    statement: Pick<
      BankStatement,
      | 'id'
      | 'customerId'
      | 'bookId'
      | 'companyId'
      | 'filename'
      | 'accountName'
      | 'bankName'
    > & {
      periodStart: Date | null;
      periodEnd: Date | null;
      accountKind?: BankStatement['accountKind'];
    },
    pdf: Buffer,
    pages: readonly ImagePage[],
  ): Promise<void> {
    // The images belong to the statement's own book (general, or one company's).
    const scope = scopeOf(statement);
    try {
      // A card has no cheques: whatever image it prints is a logo or a summary box.
      const all =
        statement.accountKind === 'CREDIT_CARD'
          ? []
          : await itemImages(pdf, pages);
      const images: ItemImage[] = [];
      for (const image of all) {
        if (await this.isChequeLike(image)) images.push(image);
        else {
          this.logger.log(
            `statement #${statement.id} p${image.page + 1}: image ${image.index + 1} is not a cheque — skipped`,
          );
        }
      }
      const label = statementLabel(statement);
      const refs: string[] = [];
      for (const image of images) {
        const sourceRef = statementImageRef(
          statement.id,
          image.page,
          image.index,
        );
        refs.push(sourceRef);
        const existing = await this.prisma.transactionAttachment.findUnique({
          where: { sourceRef },
          select: { storageKey: true, sourceStorageKey: true },
        });
        // step2 (2026-11-08): a row that was cut into cheques points at its CROP; the image
        // itself is its `sourceStorageKey`. The new image goes there, the row points back at
        // it uncut, and the old crop is removed — it used to overwrite the crop's key with
        // the whole image while the reader kept reading the stale original.
        const storageKey =
          existing?.sourceStorageKey ??
          existing?.storageKey ??
          `${storagePrefix(scope)}/attachments/${randomUUID()}.png`;
        await this.storage.putBuffer(storageKey, image.png, 'image/png');
        if (existing?.sourceStorageKey && existing.storageKey !== storageKey) {
          await this.storage.delete(existing.storageKey).catch(() => undefined);
        }
        const queued = {
          storageKey,
          sourceStorageKey: null,
          mimeType: 'image/png',
          status: AttachmentStatus.PENDING,
          transactionId: null,
          extracted: Prisma.DbNull,
          matchNote: null,
          error: null,
          attempts: 0,
          nextAttemptAt: null,
          deletedAt: null,
          size: image.png.length,
        };
        await this.prisma.transactionAttachment.upsert({
          where: { sourceRef },
          create: {
            ...queued,
            ...scopeWhere(scope),
            filename: (image.caption?.number
              ? `${label} cheque ${image.caption.number}.png`
              : `${label} p${image.page + 1} #${image.index + 1}.png`
            ).slice(0, 255),
            mimeType: 'image/png',
            storageKey,
            source: STATEMENT_SOURCE,
            sourceRef,
          },
          update: queued,
        });
      }
      // A re-read that no longer sees an image drops the attachment it made before.
      await this.prisma.transactionAttachment.updateMany({
        where: {
          ...scopeWhere(scope),
          sourceRef: { startsWith: `stmt:${statement.id}:`, notIn: refs },
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      await this.dropSiblingsOfDeleted(scope);
      if (images.length) this.attachments.processSoon();
      if (pages.length) {
        this.logger.log(
          `statement #${statement.id}: ${images.length} item image(s) from ${pages.length} page(s)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `statement #${statement.id}: item images not attached: ${String(err)}`,
      );
    }
  }

  /** A deleted statement takes the images cut out of it along. */
  async removeFor(scope: BookScope, statementId: number): Promise<void> {
    await this.prisma.transactionAttachment.updateMany({
      where: {
        ...scopeWhere(scope),
        sourceRef: { startsWith: `stmt:${statementId}:` },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });
    await this.dropSiblingsOfDeleted(scope);
  }

  /**
   * step8 (2026-11-11): the OTHER documents read off a statement image (`doc:<rowId>:<n>`, one
   * per cheque) outlived it — 22 crops of deleted TD statements sat UNMATCHED in book 2 as
   * errors. A sibling goes with its deleted parent unless it is attached to a row of a live
   * statement (the customer's own filing). Book-scoped, or every book (the boot sweep).
   */
  async dropSiblingsOfDeleted(scope?: BookScope): Promise<number> {
    const alive = await this.prisma.transactionAttachment.findMany({
      where: {
        ...(scope ? scopeWhere(scope) : {}),
        source: 'STATEMENT',
        sourceRef: { startsWith: 'doc:' },
        deletedAt: null,
      },
      select: { id: true, sourceRef: true, transactionId: true },
    });
    if (!alive.length) return 0;
    const parentOf = (ref: string | null) => Number(ref?.split(':')[1]);
    const parents = await this.prisma.transactionAttachment.findMany({
      where: {
        id: { in: [...new Set(alive.map((a) => parentOf(a.sourceRef)))] },
      },
      select: { id: true, deletedAt: true },
    });
    const dead = new Set(parents.filter((p) => p.deletedAt).map((p) => p.id));
    const orphans = alive.filter((a) => dead.has(parentOf(a.sourceRef)));
    if (!orphans.length) return 0;
    const txIds = orphans
      .map((o) => o.transactionId)
      .filter((t): t is number => !!t);
    const liveTx = new Set(
      (
        await this.prisma.bankTransaction.findMany({
          where: { id: { in: txIds }, statement: { deletedAt: null } },
          select: { id: true },
        })
      ).map((t) => t.id),
    );
    const drop = orphans
      .filter((o) => !o.transactionId || !liveTx.has(o.transactionId))
      .map((o) => o.id);
    if (!drop.length) return 0;
    await this.prisma.transactionAttachment.updateMany({
      where: { id: { in: drop } },
      data: { deletedAt: new Date() },
    });
    this.logger.log(
      `${drop.length} cut document(s) of deleted statement images removed`,
    );
    // A sibling can itself have siblings (a crop read again): go one level further.
    return drop.length + (await this.dropSiblingsOfDeleted(scope));
  }

  /** Once a minute after start: the crops left over from before the fix above. */
  onApplicationBootstrap(): void {
    setTimeout(() => {
      void this.dropSiblingsOfDeleted().catch((err: unknown) =>
        this.logger.warn(`orphan crop sweep failed: ${String(err)}`),
      );
    }, 75_000).unref?.();
  }
}
