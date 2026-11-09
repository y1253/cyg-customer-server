import { join } from 'path';
import { existsSync } from 'fs';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OcrLine, OcrResult } from './ocr.util';

/**
 * step2 (2026-11-08): PaddleOCR, run IN this process through its ONNX port
 * (`ppu-paddle-ocr` + `onnxruntime-node`, CPU) — the first reader of every photo and of a
 * scanned PDF page. PP-OCRv6 *medium* by default: server grade, 50+ languages (English and
 * French), and it reads handwriting, which is what a cheque's payee and amount are.
 *
 * Models: `PADDLE_OCR_MODEL_DIR` holds `PP-OCRv6_medium_det.ort`, `PP-OCRv6_medium_rec.ort`
 * and `ppocrv6_dict.txt`; unset (or missing files) = the library's own download, cached in
 * `~/.cache/ppu-paddle-ocr` (~139 MB, once). ⚠️ The office filter blocks huggingface.co:
 * in dev the download comes back as its HTML "blocked" page — set the dir (the GitHub mirror,
 * `PPU_PADDLE_OCR_MODEL_MIRROR=1`, serves the same files).
 *
 * ⚠️ ESM-only package, loaded with a real dynamic `import()` — see `pdf-decrypt.ts`.
 * Never throws: `null` = could not read, and the caller hands the file to the AI as before.
 * One image at a time (the engine is CPU-bound; pm2 runs one process).
 */
@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);
  private engine: Promise<OcrEngine | null> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigService) {}

  /** `OCR=0` turns local OCR off (every image goes to the AI as before step2). */
  enabled(): boolean {
    return this.config.get<string>('OCR')?.trim() !== '0';
  }

  async read(image: Buffer, timeoutMs = 90_000): Promise<OcrResult | null> {
    if (!this.enabled()) return null;
    const run = this.queue.then(() => this.readNow(image, timeoutMs));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async onModuleDestroy(): Promise<void> {
    const engine = await this.engine?.catch(() => null);
    await engine?.destroy().catch(() => undefined);
  }

  private async readNow(
    image: Buffer,
    timeoutMs: number,
  ): Promise<OcrResult | null> {
    const engine = await this.load();
    if (!engine) return null;
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      const bytes = image.buffer.slice(
        image.byteOffset,
        image.byteOffset + image.byteLength,
      ) as ArrayBuffer;
      const result = await Promise.race([
        engine.recognize(bytes, { noCache: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${timeoutMs} ms`)),
            timeoutMs,
          );
        }),
      ]);
      const lines: OcrLine[] = (result.lines ?? []).map((line) => ({
        text: line.map((b) => b.text).join(' '),
        confidence: line.length
          ? Math.min(...line.map((b) => b.confidence))
          : 0,
        boxes: line.map((b) => ({
          text: b.text,
          confidence: b.confidence,
          x: b.box.x,
          y: b.box.y,
          width: b.box.width,
          height: b.box.height,
        })),
      }));
      this.logger.debug(
        `read ${lines.length} line(s) in ${Date.now() - started} ms`,
      );
      const size = await imageSize(image);
      if (!size) return null;
      return {
        text: lines.map((l) => l.text).join('\n'),
        confidence: Number.isFinite(result.confidence) ? result.confidence : 0,
        lines,
        ...size,
      };
    } catch (err) {
      this.logger.warn(
        `OCR failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** The engine, loaded once. A failed load is retried on the next file. */
  private load(): Promise<OcrEngine | null> {
    if (!this.engine) {
      this.engine = this.create().catch((err: unknown) => {
        this.logger.error(
          `PaddleOCR could not start: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.engine = null;
        return null;
      });
    }
    return this.engine;
  }

  private async create(): Promise<OcrEngine> {
    const lib = await import('ppu-paddle-ocr');
    const dir = this.config.get<string>('PADDLE_OCR_MODEL_DIR')?.trim();
    const files = dir
      ? {
          detection: join(dir, 'PP-OCRv6_medium_det.ort'),
          recognition: join(dir, 'PP-OCRv6_medium_rec.ort'),
          charactersDictionary: join(dir, 'ppocrv6_dict.txt'),
        }
      : null;
    const local = files && Object.values(files).every((f) => existsSync(f));
    if (dir && !local) {
      this.logger.warn(
        `PADDLE_OCR_MODEL_DIR=${dir} is missing model files — using the library's download`,
      );
    }
    const service = new lib.PaddleOcrService({
      model: local ? files : lib.V6_MEDIUM_MODEL,
      debugging: { verbose: false, debug: false },
    });
    const started = Date.now();
    await service.initialize();
    this.logger.log(
      `PaddleOCR ready (PP-OCRv6 medium${local ? `, ${dir}` : ''}) in ${Date.now() - started} ms`,
    );
    return service as unknown as OcrEngine;
  }
}

/** An image's size in pixels (mupdf; null = not an image it can open). */
export async function imageSize(
  image: Buffer,
): Promise<{ width: number; height: number } | null> {
  try {
    const mupdf = await import('mupdf');
    const img = new mupdf.Image(image);
    try {
      return { width: img.getWidth(), height: img.getHeight() };
    } finally {
      img.destroy();
    }
  } catch {
    return null;
  }
}

/** The slice of `PaddleOcrService` used here. */
interface OcrEngine {
  recognize(
    image: ArrayBuffer,
    options?: { noCache?: boolean },
  ): Promise<{
    confidence: number;
    lines?: Array<
      Array<{
        text: string;
        confidence: number;
        box: { x: number; y: number; width: number; height: number };
      }>
    >;
  }>;
  destroy(): Promise<void>;
}
