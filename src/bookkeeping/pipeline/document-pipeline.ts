import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AttachmentClass } from '../attachment-uploads';
import { OcrService } from './ocr.service';
import {
  chequeNumberFromOcr,
  ocrGate,
  ocrText,
  type OcrResult,
} from './ocr.util';
import { pdfPageTexts, pdfTextQuality } from './pdf-text';
import { sheetText } from './sheet-text';

/** Where a file's text came from. */
export type PipelineSource = 'OCR' | 'PDF_TEXT' | 'SHEET';

/**
 * What the local pipeline made of a file, BEFORE any AI (step2, 2026-11-08, user's rule):
 * `ok` = good enough for the AI to read as TEXT on the cheap text model; otherwise the file
 * goes to the vision model as before, with `text` (when any) as a hint.
 */
export interface Prepared {
  source: PipelineSource;
  ok: boolean;
  /** What was read, laid out as printed ('' = nothing). */
  text: string;
  /** OCR's own confidence, 0–1; null for a PDF's text layer or a spreadsheet. */
  confidence: number | null;
  /** Why it is not `ok`. */
  reason: string | null;
  /** It reads like a cheque (OCR). */
  cheque: boolean;
  /** The cheque's number as OCR read it (printed top-right / the MICR line). */
  chequeNumber: string | null;
}

/** Pages of an attachment PDF read as text (an invoice is 1–3; past this the AI reads it). */
const MAX_PDF_PAGES = 10;
/** Scanned PDF pages OCR'd at most; a longer scan goes to the vision model whole. */
const MAX_OCR_PAGES = 3;
const MAX_TEXT_CHARS = 30_000;

/**
 * step2: the local reading pipeline — PaddleOCR for images (and scanned PDF pages), the PDF's
 * own text layer (mupdf), exceljs / CSV for spreadsheets. Audio and text messages never pass
 * here (a voice note always goes to the model: no pipeline can hear). Never throws: a failure
 * is `null` / `ok: false`, and the AI reads the file exactly as before step2.
 */
@Injectable()
export class DocumentPipeline {
  private readonly logger = new Logger(DocumentPipeline.name);

  constructor(
    private readonly ocr: OcrService,
    private readonly config: ConfigService,
  ) {}

  /** `DOC_PIPELINE=0` = every file goes straight to the AI (the pre-step2 behaviour). */
  enabled(): boolean {
    return this.config.get<string>('DOC_PIPELINE')?.trim() !== '0';
  }

  /** OCR of one image (null = off / failed). Used for the cheques cut by code too. */
  readImage(image: Buffer): Promise<OcrResult | null> {
    return this.enabled() ? this.ocr.read(image) : Promise.resolve(null);
  }

  async prepare(
    file: Buffer,
    mime: string,
    cls: AttachmentClass,
    /** An OCR already made of this image (a cheque cut by code). */
    known?: OcrResult | null,
  ): Promise<Prepared | null> {
    // A spreadsheet has no other reader: it is read here even with the pipeline off.
    if (cls === 'sheet') return this.sheet(file, mime);
    if (!this.enabled()) return null;
    try {
      if (cls === 'image')
        return this.fromOcr(known ?? (await this.ocr.read(file)));
      if (cls === 'pdf') return await this.pdf(file);
      return null;
    } catch (err) {
      this.logger.warn(
        `pipeline failed (${cls}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** An image's OCR, judged. */
  fromOcr(r: OcrResult | null): Prepared | null {
    if (!r) return null;
    const verdict = ocrGate(r);
    return {
      source: 'OCR',
      ok: verdict.ok,
      text: ocrText(r).slice(0, MAX_TEXT_CHARS),
      confidence: r.confidence,
      reason: verdict.ok ? null : verdict.reason,
      cheque: verdict.cheque,
      chequeNumber: verdict.cheque ? chequeNumberFromOcr(r) : null,
    };
  }

  private async sheet(file: Buffer, mime: string): Promise<Prepared> {
    const text = await sheetText(file, mime);
    return {
      source: 'SHEET',
      ok: !!text?.trim(),
      text: text ?? '',
      confidence: null,
      reason: text?.trim() ? null : 'could not open the spreadsheet',
      cheque: false,
      chequeNumber: null,
    };
  }

  /** The text layer when it is real; a scan's pages through OCR; else the file. */
  private async pdf(file: Buffer): Promise<Prepared | null> {
    const pages = await pdfPageTexts(file);
    if (!pages?.length) return null;
    if (pages.length <= MAX_PDF_PAGES) {
      const text = pages
        .map((t, i) => (pages.length > 1 ? `--- page ${i + 1} ---\n${t}` : t))
        .join('\n\n');
      const quality = pdfTextQuality(text);
      if (quality.ok) {
        return {
          source: 'PDF_TEXT',
          ok: true,
          text: text.slice(0, MAX_TEXT_CHARS),
          confidence: null,
          reason: null,
          cheque: false,
          chequeNumber: null,
        };
      }
    }
    if (pages.length > MAX_OCR_PAGES) {
      return {
        source: 'PDF_TEXT',
        ok: false,
        text: '',
        confidence: null,
        reason: `${pages.length} pages with no usable text layer`,
        cheque: false,
        chequeNumber: null,
      };
    }
    // A scan: each page through OCR; all of them must pass for the text to stand alone.
    const reads: Prepared[] = [];
    for (const png of await pdfPagePngs(file, MAX_OCR_PAGES)) {
      const p = this.fromOcr(await this.ocr.read(png));
      if (!p) return null;
      reads.push(p);
    }
    if (!reads.length) return null;
    const failed = reads.find((r) => !r.ok);
    return {
      source: 'OCR',
      ok: !failed,
      text: reads
        .map((r, i) =>
          reads.length > 1 ? `--- page ${i + 1} ---\n${r.text}` : r.text,
        )
        .join('\n\n')
        .slice(0, MAX_TEXT_CHARS),
      confidence: Math.min(...reads.map((r) => r.confidence ?? 0)),
      reason: failed?.reason ?? null,
      cheque: reads.some((r) => r.cheque),
      chequeNumber: reads.length === 1 ? reads[0].chequeNumber : null,
    };
  }
}

/** The first pages of a PDF as PNGs at 144 dpi (OCR input). [] when it cannot be opened. */
export async function pdfPagePngs(pdf: Buffer, max: number): Promise<Buffer[]> {
  try {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
    try {
      if (doc.needsPassword()) return [];
      const out: Buffer[] = [];
      const count = Math.min(doc.countPages(), max);
      for (let i = 0; i < count; i++) {
        const page = doc.loadPage(i);
        try {
          const pix = page.toPixmap(
            [2, 0, 0, 2, 0, 0],
            mupdf.ColorSpace.DeviceRGB,
            false,
          );
          try {
            out.push(Buffer.from(pix.asPNG()));
          } finally {
            pix.destroy();
          }
        } finally {
          page.destroy();
        }
      }
      return out;
    } finally {
      doc.destroy();
    }
  } catch {
    return [];
  }
}
