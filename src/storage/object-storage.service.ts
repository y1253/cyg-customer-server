import { createReadStream } from 'fs';
import type { Readable } from 'stream';
import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

/**
 * Cloudflare R2, the same bucket the internal app uses. A trimmed copy of
 * `internal/server/src/storage/object-storage.service.ts` — read that file's docblocks for
 * the why. The rules kept here:
 *
 * - The object KEY is what the database stores (`bookkeeping/<customerId>/<uuid>.pdf`),
 *   never a URL, so moving account/bucket/host is an `.env` edit.
 * - The endpoint is DERIVED from `R2_ACCOUNT_ID`, never read from env.
 * - Checksums are pinned to `WHEN_REQUIRED` and the AWS SDK is pinned EXACTLY in
 *   package.json (3.1138.0, the internal app's pin) — the SDK default has broken R2 before.
 * - Unlike the internal copy there is no local-disk driver: the customer app has never
 *   stored files anywhere else.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private client: S3Client | null = null;
  private readonly bucket: string | null;

  constructor() {
    const raw = (
      process.env.R2_BUCKET ||
      process.env.R2_BUCKET_NAME ||
      ''
    ).trim();
    if (raw && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(raw)) {
      // A URL-shaped value here has happened before; refuse to boot rather than 400 every upload.
      throw new Error(
        `R2_BUCKET_NAME is "${raw}", which is not a bucket name (the endpoint is derived from R2_ACCOUNT_ID).`,
      );
    }
    this.bucket = raw || null;
    if (!this.configured) {
      this.logger.warn(
        'R2 is not configured — bookkeeping uploads will be refused.',
      );
    }
  }

  get configured(): boolean {
    return Boolean(
      this.bucket &&
      process.env.R2_ACCOUNT_ID?.trim() &&
      process.env.R2_ACCESS_KEY_ID?.trim() &&
      process.env.R2_SECRET_ACCESS_KEY?.trim(),
    );
  }

  private s3(): S3Client {
    if (!this.configured) throw new Error('R2 is not configured');
    this.client ??= new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID!.trim()}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(),
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    return this.client;
  }

  /** Refuse a malformed key before it mints an object nothing can address again. */
  assertKey(key: string): void {
    const bad =
      !key ||
      key !== key.trim() ||
      key.startsWith('/') ||
      key.includes('\\') ||
      key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
    if (bad) throw new Error(`Refusing a malformed storage key: "${key}"`);
  }

  /** Stream a staged file to R2 without reading it into memory (multipart above 8 MB). */
  async putFile(
    key: string,
    absolutePath: string,
    contentType?: string,
  ): Promise<void> {
    this.assertKey(key);
    await new Upload({
      client: this.s3(),
      partSize: 8 * 1024 * 1024,
      queueSize: 4,
      params: {
        Bucket: this.bucket!,
        Key: key,
        Body: createReadStream(absolutePath),
        ContentType: contentType,
      },
    }).done();
  }

  /** Size, or null when the object is not there. */
  async head(key: string): Promise<{ size: number } | null> {
    this.assertKey(key);
    try {
      const res = await this.s3().send(
        new HeadObjectCommand({ Bucket: this.bucket!, Key: key }),
      );
      return { size: res.ContentLength ?? 0 };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getStream(key: string): Promise<Readable> {
    this.assertKey(key);
    const res = await this.s3().send(
      new GetObjectCommand({ Bucket: this.bucket!, Key: key }),
    );
    if (!res.Body) throw new Error(`R2 returned no body for "${key}"`);
    return res.Body as Readable;
  }

  async getBuffer(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.getStream(key))
      chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);
    await this.s3().send(
      new DeleteObjectCommand({ Bucket: this.bucket!, Key: key }),
    );
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.$metadata?.httpStatusCode === 404 ||
    e?.name === 'NotFound' ||
    e?.name === 'NoSuchKey'
  );
}
