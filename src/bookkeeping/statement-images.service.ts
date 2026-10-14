import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AttachmentStatus, Prisma, type BankStatement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { statementImageRef } from './attachment-match.util';
import { AttachmentProcessorService } from './attachment-processor.service';
import { itemImages, type ImagePage } from './pdf-images';
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
  ) {}

  /** Never throws — a statement is done whether or not its images could be cut out. */
  async harvest(
    statement: Pick<
      BankStatement,
      'id' | 'customerId' | 'filename' | 'accountName' | 'bankName'
    > & { periodStart: Date | null; periodEnd: Date | null },
    pdf: Buffer,
    pages: readonly ImagePage[],
  ): Promise<void> {
    try {
      const images = await itemImages(pdf, pages);
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
          select: { storageKey: true },
        });
        const storageKey =
          existing?.storageKey ??
          `bookkeeping/${statement.customerId}/attachments/${randomUUID()}.png`;
        await this.storage.putBuffer(storageKey, image.png, 'image/png');
        const queued = {
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
            customerId: statement.customerId,
            filename:
              `${label} p${image.page + 1} #${image.index + 1}.png`.slice(
                0,
                255,
              ),
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
          customerId: statement.customerId,
          sourceRef: { startsWith: `stmt:${statement.id}:`, notIn: refs },
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
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
  async removeFor(customerId: number, statementId: number): Promise<void> {
    await this.prisma.transactionAttachment.updateMany({
      where: {
        customerId,
        sourceRef: { startsWith: `stmt:${statementId}:` },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });
  }
}
