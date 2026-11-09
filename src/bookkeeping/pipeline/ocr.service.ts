import { dirname, join } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OcrEngineName, OcrLine, OcrResult } from './ocr.util';

/**
 * step2 (2026-11-08): local OCR, the first reader of every photo and of a scanned PDF page.
 *
 * Two engines, picked by `OCR_ENGINE` (step2c, 2026-11-09):
 * - `tesseract` (DEFAULT) — tesseract.js (WASM, far less RAM), English + French LSTM models
 *   shipped in `@tesseract.js-data/{eng,fra}` (nothing downloads). Printed text only: it cannot
 *   read handwriting, so `ocrGate` never lets a cheque it read go text-only (the handwritten
 *   amount / payee go to the vision model) — user's choice on the 1.9 GB host: "use Tesseract,
 *   and for handwriting or anything it can't read pass to the model".
 * - `paddle` — PaddleOCR (below), reads handwriting but needs ~1.2 GB; for a bigger host.
 *
 * PaddleOCR, run IN this process through its ONNX port
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
  private engine: Promise<Engine | null> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigService) {}

  /** `OCR=0` turns local OCR off (every image goes to the AI as before step2). */
  enabled(): boolean {
    return this.config.get<string>('OCR')?.trim() !== '0';
  }

  /** `OCR_ENGINE`: tesseract (default) or paddle. */
  engineName(): OcrEngineName {
    return this.config.get<string>('OCR_ENGINE')?.trim().toLowerCase() ===
      'paddle'
      ? 'paddle'
      : 'tesseract';
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
      const result = await Promise.race([
        engine.recognize(image),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${timeoutMs} ms`)),
            timeoutMs,
          );
        }),
      ]);
      const { lines } = result;
      this.logger.debug(
        `${engine.name} read ${lines.length} line(s) in ${Date.now() - started} ms`,
      );
      const size = await imageSize(image);
      if (!size) return null;
      return {
        text: lines.map((l) => l.text).join('\n'),
        confidence: Number.isFinite(result.confidence) ? result.confidence : 0,
        lines,
        engine: engine.name,
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
  private load(): Promise<Engine | null> {
    if (!this.engine) {
      const name = this.engineName();
      this.engine = (
        name === 'paddle' ? this.createPaddle() : this.createTesseract()
      ).catch((err: unknown) => {
        this.logger.error(
          `${name} OCR could not start: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.engine = null;
        return null;
      });
    }
    return this.engine;
  }

  /**
   * tesseract.js: one worker, English + French LSTM (`4.0.0_best_int`, LSTM-only) read from
   * the installed data packages — no CDN, no cache files written next to the process.
   * ⚠️ Both files are copied into ONE folder (`langPath` is a single folder per worker); the
   * library's in-memory `{ code, data }` languages are broken in 7.0.0 (init is handed the bytes
   * as the language name).
   */
  private async createTesseract(): Promise<Engine> {
    const tesseract = await import('tesseract.js');
    const langPath = join(tmpdir(), 'cyg-tessdata');
    mkdirSync(langPath, { recursive: true });
    for (const code of ['eng', 'fra']) {
      const file = `${code}.traineddata.gz`;
      copyFileSync(
        join(
          dirname(require.resolve(`@tesseract.js-data/${code}/package.json`)),
          '4.0.0_best_int',
          file,
        ),
        join(langPath, file),
      );
    }
    const started = Date.now();
    const worker = await tesseract.createWorker(
      'eng+fra',
      tesseract.OEM.LSTM_ONLY,
      { langPath, cacheMethod: 'none', gzip: true },
    );
    this.logger.log(`Tesseract ready (eng+fra) in ${Date.now() - started} ms`);
    return {
      name: 'tesseract',
      async recognize(image) {
        const { data } = await worker.recognize(image, {}, { blocks: true });
        const lines: OcrLine[] = [];
        for (const block of data.blocks ?? []) {
          for (const para of block.paragraphs) {
            for (const line of para.lines) {
              const words = line.words.filter((w) => w.text.trim());
              if (!words.length) continue;
              lines.push({
                text: words.map((w) => w.text).join(' '),
                confidence: Math.min(...words.map((w) => w.confidence)) / 100,
                boxes: words.map((w) => ({
                  text: w.text,
                  confidence: w.confidence / 100,
                  x: w.bbox.x0,
                  y: w.bbox.y0,
                  width: w.bbox.x1 - w.bbox.x0,
                  height: w.bbox.y1 - w.bbox.y0,
                })),
              });
            }
          }
        }
        return { confidence: data.confidence / 100, lines };
      },
      async destroy() {
        await worker.terminate();
      },
    };
  }

  private async createPaddle(): Promise<Engine> {
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
    const paddle = service as unknown as PaddleEngine;
    return {
      name: 'paddle',
      async recognize(image) {
        const bytes = image.buffer.slice(
          image.byteOffset,
          image.byteOffset + image.byteLength,
        ) as ArrayBuffer;
        const result = await paddle.recognize(bytes, { noCache: true });
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
        return { confidence: result.confidence, lines };
      },
      destroy: () => paddle.destroy(),
    };
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

/** A loaded engine, its output already in our shape (confidences 0–1, image pixels). */
interface Engine {
  name: OcrEngineName;
  recognize(image: Buffer): Promise<{ confidence: number; lines: OcrLine[] }>;
  destroy(): Promise<void>;
}

/** The slice of `PaddleOcrService` used here. */
interface PaddleEngine {
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
