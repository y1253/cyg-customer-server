import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/** Per-file ceiling. A bank statement is a few MB; 50 MB covers a long scanned one. */
export const MAX_STATEMENT_BYTES = 50 * 1024 * 1024;
/** Files per REQUEST. The client batches, so the number a customer can upload is unlimited. */
export const MAX_FILES_PER_REQUEST = 20;

const STAGING_DIR = join(
  process.env.UPLOADS_DIR?.trim() || join(process.cwd(), 'uploads'),
  'bookkeeping-staging',
);

/**
 * Uploads are staged on DISK (never memory — a batch of 20 x 50 MB would be 1 GB of heap)
 * and streamed to R2 by `BookkeepingService.upload`, which deletes the staged copy in a
 * `finally`. PDF only: the extension must say PDF, and the declared type must not
 * contradict it (some browsers send `application/octet-stream`).
 */
export const STATEMENT_UPLOAD_OPTIONS: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(STAGING_DIR, { recursive: true });
      cb(null, STAGING_DIR);
    },
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.pdf`),
  }),
  limits: { fileSize: MAX_STATEMENT_BYTES, files: MAX_FILES_PER_REQUEST },
  fileFilter: (_req, file, cb) => {
    const isPdfName = /\.pdf$/i.test(file.originalname);
    const okType = [
      'application/pdf',
      'application/x-pdf',
      'application/octet-stream',
      '',
    ].includes(file.mimetype);
    if (isPdfName && okType) return cb(null, true);
    cb(
      new BadRequestException(
        `"${file.originalname}" is not a PDF. Only PDF statements can be uploaded.`,
      ),
      false,
    );
  },
};

/** Deletes staged files older than `maxAgeMs`. Never throws; returns how many went. */
export async function sweepStaleStaging(maxAgeMs: number): Promise<number> {
  let names: string[];
  try {
    names = await readdir(STAGING_DIR);
  } catch {
    return 0; // nothing staged yet
  }
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of names) {
    const full = join(STAGING_DIR, name);
    try {
      if ((await stat(full)).mtimeMs < cutoff) {
        await unlink(full);
        removed++;
      }
    } catch {
      // already gone, or in use — the next sweep tries again
    }
  }
  return removed;
}
