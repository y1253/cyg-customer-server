/**
 * Runs the REAL statement extractor, reconciliation and ledger rules against a PDF, with
 * no database and no R2 — the cheapest way to see what OpenAI makes of a statement and
 * whether it adds up. Costs one OpenAI call per page, plus any re-reads.
 *
 *   NODE_OPTIONS=--use-system-ca npx ts-node -T scripts/bookkeeping-probe.ts <statement.pdf> [--pages=N] [--quiet]
 *
 * `--pages=3` reads three pages per request, which has made gpt-4o drop rows.
 * `--sabotage` deletes one row from page 2's FIRST reading, deterministically — the way to
 * watch the checks catch a dropped row and a real re-read repair it.
 * `--images[=dir]` cuts the cheque / deposit-slip images out of the pages the reader
 * flagged and writes them as PNGs (default dir: next to the PDF). `--image-pages=3,4` does
 * only that, for those 1-based pages, with no OpenAI call at all.
 * (`--use-system-ca` only on the office network, whose TLS proxy re-signs api.openai.com.)
 *
 * step2 (2026-11-08) — the local reading pipeline, no OpenAI call unless said:
 * `--cheques` on an IMAGE (or a PDF: every page's item images): the cheques code finds
 * (`cheque-split.ts`), each crop written as a PNG, its OCR text (`OCR_ENGINE`), cheque number and
 * whether the text alone would be read (`ocrGate`). Needs `PADDLE_OCR_MODEL_DIR` (or the
 * library's download).
 * `--prepare` on any attachment (photo, PDF, .xlsx, .csv): what `DocumentPipeline.prepare`
 * hands the AI — the text, its source, and whether it goes text-only.
 * `--page-text` on a statement: each page's laid-out text layer and `pdfTextQuality`.
 * `--text-pipeline` on a statement: reads it TWICE (the PDF, then its text layer —
 * `STATEMENT_TEXT_PIPELINE=1`) and prints both verifications and call counts side by side.
 * Turn the env switch on in production only when the hard statements still verify.
 *
 * step2 (2026-11-12) — cheques found by OpenCV, read one at a time:
 * `--cv` on an image: the rectangles OpenCV finds, each OCR'd (number / back), the backs joined
 * to their fronts, and one PNG per cheque as it would be cut (`<name>-cv/`). No OpenAI.
 * `--read-cheques` on an image: the same, then each cheque read on its own by the real reader
 * (`readChequesAlone`, OpenAI) — or, when fewer than two are found, the whole image as before.
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import type { ConfigService } from '@nestjs/config';
import { OpenAiClient, type ChatRequest } from '../src/ai/openai.client';
import { classOf } from '../src/bookkeeping/attachment-processor.service';
import { attachmentType } from '../src/bookkeeping/attachment-uploads';
import { chequeRegions } from '../src/bookkeeping/cheque-split';
import { cropImage } from '../src/bookkeeping/crop';
import { AttachmentExtractor } from '../src/bookkeeping/attachment-extractor';
import {
  findCheques,
  readAlone,
  readChequesAlone,
} from '../src/bookkeeping/cheque-reading';
import { readerHints } from '../src/bookkeeping/attachment-processor.service';
import { buildLedgerRows } from '../src/bookkeeping/ledger.util';
import { itemImages, type ImagePage } from '../src/bookkeeping/pdf-images';
import { DocumentPipeline } from '../src/bookkeeping/pipeline/document-pipeline';
import { OcrService } from '../src/bookkeeping/pipeline/ocr.service';
import {
  chequeNumberFromOcr,
  looksLikeChequeBack,
  ocrGate,
} from '../src/bookkeeping/pipeline/ocr.util';
import {
  pdfPageTexts,
  pdfTextQuality,
} from '../src/bookkeeping/pipeline/pdf-text';
import { describeCheck } from '../src/bookkeeping/reconcile.util';
import { StatementExtractor } from '../src/bookkeeping/statement-extractor';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file)
    throw new Error('usage: bookkeeping-probe.ts <statement.pdf> [--pages=N]');
  const pagesArg = process.argv.find((a) => a.startsWith('--pages='));
  const quiet = process.argv.includes('--quiet');
  const imagesArg = process.argv.find((a) => a.startsWith('--images'));
  const onlyPages = process.argv.find((a) => a.startsWith('--image-pages='));
  const imagesDir =
    imagesArg?.split('=')[1] ||
    join(dirname(file), `${basename(file, '.pdf')}-images`);
  const config0 = {
    get: (k: string) => process.env[k],
  } as unknown as ConfigService;
  if (process.argv.includes('--cheques')) return cheques(file, config0);
  if (process.argv.includes('--cv')) return cv(file, config0, false);
  if (process.argv.includes('--read-cheques')) return cv(file, config0, true);
  if (process.argv.includes('--prepare')) return prepare(file, config0);
  if (process.argv.includes('--page-text')) return pageText(file);
  if (process.argv.includes('--text-pipeline')) return compare(file);
  if (onlyPages) {
    const pages = onlyPages
      .split('=')[1]
      .split(',')
      .map((n) => ({ page: Number(n) - 1, hasRows: false }));
    await writeImages(readFileSync(file), pages, imagesDir);
    return;
  }
  const config = {
    get: (k: string) => process.env[k],
  } as unknown as ConfigService;
  const client = process.argv.includes('--sabotage')
    ? new SabotagingClient(config)
    : new OpenAiClient(config);
  const extractor = new StatementExtractor(client, config);

  const started = Date.now();
  const out = await extractor.extract(readFileSync(file), basename(file), {
    pagesPerChunk: pagesArg ? Number(pagesArg.split('=')[1]) : undefined,
  });
  const rows = buildLedgerRows(
    out.transactions,
    out.accountName ?? 'Bank account',
  );

  console.log(
    `model=${extractor.model()} verify=${extractor.verifyModel()} ${Date.now() - started}ms, ${out.calls} call(s)`,
  );
  console.log(
    `account="${out.accountName}" bank="${out.bankName}" period=${out.periodStart}..${out.periodEnd} rows=${rows.length}`,
  );
  console.log(`stated: ${JSON.stringify(out.stated)}`);
  console.log(
    `VERIFICATION: ${out.verification.verification} after ${out.rereads} re-read(s)`,
  );
  for (const c of out.verification.checks)
    console.log(
      `  ${c.skipped ? 'skip' : c.ok ? 'ok  ' : 'FAIL'} ${describeCheck(c)}`,
    );
  console.log(
    `image pages: ${out.imagePages.map((p) => `${p.page + 1}${p.hasRows ? ' (with rows)' : ''}`).join(', ') || 'none'}`,
  );
  if (imagesArg)
    await writeImages(readFileSync(file), out.imagePages, imagesDir);
  if (!quiet) {
    console.table(
      rows.slice(0, 12).map((r) => ({
        posting: r.postingDate?.toISOString().slice(0, 10) ?? '',
        description: r.description.slice(0, 34),
        amount: r.amount,
        balance: r.balanceAfter,
        debit: r.debitAccount,
        credit: r.creditAccount,
      })),
    );
  }
}

/** step2: the cheques code finds in an image (or a PDF's item images), with their OCR. */
async function cheques(file: string, config: ConfigService): Promise<void> {
  const bytes = readFileSync(file);
  const sources: Array<{ name: string; png: Buffer; mime: string }> = [];
  if (file.toLowerCase().endsWith('.pdf')) {
    const count = (await pdfPageTexts(bytes))?.length ?? 0;
    const pages = Array.from({ length: count }, (_, page) => ({
      page,
      hasRows: false,
    }));
    for (const img of await itemImages(bytes, pages)) {
      sources.push({
        name: `p${img.page + 1}-${img.index + 1}`,
        png: img.png,
        mime: 'image/png',
      });
    }
  } else {
    const type = attachmentType(file);
    sources.push({
      name: basename(file).replace(/\.[^.]+$/, ''),
      png: bytes,
      mime: type?.mime ?? 'image/png',
    });
  }
  const ocr = new OcrService(config);
  const dir = join(
    dirname(file),
    `${basename(file).replace(/\.[^.]+$/, '')}-cheques`,
  );
  mkdirSync(dir, { recursive: true });
  for (const src of sources) {
    const boxes = await chequeRegions(src.png, src.mime);
    console.log(
      `\n${src.name}: ${boxes.length} cheque region(s) found by code`,
    );
    const crops = boxes.length
      ? await cropImage(src.png, src.mime, boxes)
      : [src.png];
    for (const [i, crop] of crops.entries()) {
      const path = join(dir, `${src.name}-${i + 1}.png`);
      writeFileSync(path, crop);
      const started = Date.now();
      const r = await ocr.read(crop);
      if (!r) {
        console.log(`  #${i + 1} ${path}: OCR read nothing`);
        continue;
      }
      const gate = ocrGate(r);
      console.log(
        `  #${i + 1} ${path} (${Date.now() - started} ms, conf ${r.confidence.toFixed(2)}): ` +
          `number=${chequeNumberFromOcr(r) ?? '—'} back=${looksLikeChequeBack(r)} ` +
          `text-only=${gate.ok ? 'yes' : `no (${gate.reason})`}`,
      );
      for (const l of r.lines)
        console.log(`      ${l.confidence.toFixed(2)}  ${l.text}`);
    }
  }
  await ocr.onModuleDestroy();
}

/**
 * step2 (2026-11-12): the cheques of one image as production finds them (`findCheques`), the
 * cuts written next to it; with `read`, each read on its own by the real reader.
 */
async function cv(
  file: string,
  config: ConfigService,
  read: boolean,
): Promise<void> {
  const bytes = readFileSync(file);
  const mime = attachmentType(file)?.mime ?? 'image/png';
  const ocr = new OcrService(config);
  const pipeline = new DocumentPipeline(ocr, config);
  const started = Date.now();
  const found = await findCheques(bytes, mime, pipeline);
  console.log(`${Date.now() - started} ms`);
  const dir = join(
    dirname(file),
    `${basename(file).replace(/\.[^.]+$/, '')}-cv`,
  );
  mkdirSync(dir, { recursive: true });
  if (!found) console.log('fewer than two cheque rectangles — read whole');
  else {
    console.log(`found by ${found.by}:`);
    found.regions.forEach((r, i) =>
      console.log(
        `  region ${i + 1} ${JSON.stringify(r.box)} back=${r.back} number=${r.chequeNumber ?? '—'}`,
      ),
    );
    const cuts = found.cheques.length
      ? await cropImage(
          bytes,
          mime,
          found.cheques.map((c) => c.box),
        )
      : [];
    cuts.forEach((png, i) => {
      const path = join(dir, `cheque-${i + 1}.png`);
      writeFileSync(path, png);
      console.log(
        `  cheque ${i + 1} number=${found.cheques[i].number ?? '—'} → ${path}`,
      );
    });
  }
  if (read) {
    const extractor = new AttachmentExtractor(new OpenAiClient(config), config);
    const today = new Date().toISOString().slice(0, 10);
    const hints = readerHints('STATEMENT', null);
    const readings =
      found && readAlone(found)
        ? await readChequesAlone({
            file: bytes,
            mime,
            cheques: found.cheques,
            extractor,
            pipeline,
            filename: basename(file),
            today,
            message: null,
            hints,
          })
        : null;
    const all =
      readings ??
      (await extractor.read(
        bytes,
        basename(file),
        mime,
        'image',
        today,
        null,
        hints,
        await pipeline.prepare(bytes, mime, 'image'),
        found?.regions ?? [],
      ));
    console.log(readings ? 'read one by one:' : 'read whole:');
    for (const r of all) {
      console.log(
        `  ${r.documentType} #${r.checkNumber ?? '—'} payee=${r.payee ?? r.vendor ?? '—'} ` +
          `amount=${r.total ?? '—'} date=${r.date ?? '—'} memo=${r.memo ?? '—'} box=${JSON.stringify(r.box)}`,
      );
    }
  }
  await ocr.onModuleDestroy();
}

/** step2: what the local pipeline hands the AI for one attachment. */
async function prepare(file: string, config: ConfigService): Promise<void> {
  const type = attachmentType(file);
  if (!type) throw new Error(`not an attachment type: ${file}`);
  const ocr = new OcrService(config);
  const pipeline = new DocumentPipeline(ocr, config);
  const started = Date.now();
  const p = await pipeline.prepare(
    readFileSync(file),
    type.mime,
    classOf(type.mime),
  );
  console.log(`${Date.now() - started} ms`);
  if (!p) console.log('nothing prepared — the AI reads the file as before');
  else {
    console.log(
      `source=${p.source} ok=${p.ok} confidence=${p.confidence ?? '—'} ` +
        `cheque=${p.cheque} number=${p.chequeNumber ?? '—'} reason=${p.reason ?? '—'}`,
    );
    console.log(p.text);
  }
  await ocr.onModuleDestroy();
}

/** step2: each statement page's laid-out text layer, judged. */
async function pageText(file: string): Promise<void> {
  const pages = await pdfPageTexts(readFileSync(file));
  if (!pages) throw new Error('mupdf could not open the PDF');
  pages.forEach((t, i) => {
    const q = pdfTextQuality(t);
    console.log(
      `\n===== page ${i + 1}: ${q.ok ? 'TEXT' : `PDF (${q.reason})`} =====`,
    );
    console.log(t);
  });
}

/** step2: the same statement read from the PDF and from its text layer. */
async function compare(file: string): Promise<void> {
  const pdf = readFileSync(file);
  for (const textMode of [false, true]) {
    const config = {
      get: (k: string) =>
        k === 'STATEMENT_TEXT_PIPELINE'
          ? textMode
            ? '1'
            : '0'
          : process.env[k],
    } as unknown as ConfigService;
    const ex = new StatementExtractor(new OpenAiClient(config), config);
    const started = Date.now();
    const out = await ex.extract(pdf, basename(file));
    console.log(
      `\n${textMode ? 'TEXT LAYER' : 'PDF       '}: ${out.verification.verification} after ` +
        `${out.rereads} re-read(s), ${out.calls} call(s), ${out.transactions.length} rows, ` +
        `${Date.now() - started} ms, image pages ${out.imagePages.map((p) => p.page + 1).join(',') || 'none'}`,
    );
    for (const c of out.verification.checks.filter((c) => !c.ok && !c.skipped))
      console.log(`    FAIL ${describeCheck(c)}`);
  }
}

async function writeImages(
  pdf: Buffer,
  pages: ImagePage[],
  dir: string,
): Promise<void> {
  const images = await itemImages(pdf, pages);
  mkdirSync(dir, { recursive: true });
  for (const img of images) {
    const path = join(dir, `p${img.page + 1}-${img.index + 1}.png`);
    writeFileSync(path, img.png);
    console.log(
      `wrote ${path} (${img.png.length} bytes)${img.withBack ? ' front+back' : ''} caption=${JSON.stringify(img.caption)}`,
    );
  }
  if (!images.length) console.log('no item images found');
}

/** Drops the 5th row from the first reading of page 2 only; re-reads go through untouched. */
class SabotagingClient extends OpenAiClient {
  private sabotaged = false;
  async chat(req: ChatRequest): Promise<string> {
    const reply = await super.chat(req);
    const first =
      Array.isArray(req.user) && req.user[0].type === 'text'
        ? req.user[0].text
        : '';
    if (
      !this.sabotaged &&
      /page 2 of/.test(first) &&
      !/does NOT add up/.test(first)
    ) {
      this.sabotaged = true;
      const parsed = JSON.parse(reply) as { transactions: unknown[] };
      const [gone] = parsed.transactions.splice(4, 1);
      console.log(
        `SABOTAGE: removed from page 2's first reading -> ${JSON.stringify(gone)}`,
      );
      return JSON.stringify(parsed);
    }
    return reply;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
