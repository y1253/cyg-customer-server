import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { MAX_FILES_PER_REQUEST } from './statement-uploads';

/** Per-file ceiling: a phone photo is a few MB, OpenAI's audio upload caps at 25 MB. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export { MAX_FILES_PER_REQUEST };

/** Shares the statements' staging dir, so the hourly `sweepStaleStaging` covers it too. */
const STAGING_DIR = join(
  process.env.UPLOADS_DIR?.trim() || join(process.cwd(), 'uploads'),
  'bookkeeping-staging',
);

/** `text`: a text message's words (SMS intake only, never uploaded). */
export type AttachmentClass = 'pdf' | 'image' | 'audio' | 'text';

/** Extension → what the file is and the type it is stored and served as. */
const KNOWN: Record<string, { cls: AttachmentClass; mime: string }> = {
  '.pdf': { cls: 'pdf', mime: 'application/pdf' },
  '.jpg': { cls: 'image', mime: 'image/jpeg' },
  '.jpeg': { cls: 'image', mime: 'image/jpeg' },
  '.png': { cls: 'image', mime: 'image/png' },
  '.webp': { cls: 'image', mime: 'image/webp' },
  '.gif': { cls: 'image', mime: 'image/gif' },
  '.mp3': { cls: 'audio', mime: 'audio/mpeg' },
  '.m4a': { cls: 'audio', mime: 'audio/mp4' },
  '.mp4': { cls: 'audio', mime: 'audio/mp4' },
  '.wav': { cls: 'audio', mime: 'audio/wav' },
  '.webm': { cls: 'audio', mime: 'audio/webm' },
  '.ogg': { cls: 'audio', mime: 'audio/ogg' },
  '.oga': { cls: 'audio', mime: 'audio/ogg' },
};

/**
 * What an uploaded file is, judged by its EXTENSION (the declared type is
 * client-supplied; some browsers send `application/octet-stream`). Null = refused.
 */
export function attachmentType(
  filename: string,
): { cls: AttachmentClass; mime: string; ext: string } | null {
  const ext = extname(filename).toLowerCase();
  const hit = KNOWN[ext];
  return hit ? { ...hit, ext } : null;
}

/**
 * Receipts, checks and voice notes: staged on DISK like statements and streamed to R2
 * by `AttachmentsService.upload`, which deletes the staged copy in a `finally`.
 * HEIC (the iPhone default) is refused with a sentence the customer can act on: the
 * AI cannot read it.
 */
export const ATTACHMENT_UPLOAD_OPTIONS: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(STAGING_DIR, { recursive: true });
      cb(null, STAGING_DIR);
    },
    filename: (_req, file, cb) =>
      cb(
        null,
        `${randomUUID()}${attachmentType(file.originalname)?.ext ?? ''}`,
      ),
  }),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_FILES_PER_REQUEST },
  fileFilter: (_req, file, cb) => {
    if (attachmentType(file.originalname)) return cb(null, true);
    const heic = /\.hei[cf]$/i.test(file.originalname);
    cb(
      new BadRequestException(
        heic
          ? `"${file.originalname}" is an iPhone HEIC photo. Save it as JPG (or set the camera to "Most Compatible") and upload it again.`
          : `"${file.originalname}" can't be added. Upload a photo (JPG, PNG), a PDF or a voice note (MP3, M4A, WAV, WEBM, OGG).`,
      ),
      false,
    );
  },
};
