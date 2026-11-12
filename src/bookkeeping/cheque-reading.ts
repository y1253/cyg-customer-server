import type {
  AttachmentExtractor,
  AttachmentReading,
  DocumentBox,
} from './attachment-extractor';
import { chequeRegions } from './cheque-split';
import { cropImage } from './crop';
import { scanCheques } from './pipeline/cheque-vision';
import {
  backColumn,
  cutBox,
  pairBacks,
  sameRow,
  type PxRect,
} from './pipeline/cheque-vision.util';
import { parseCaption, type Caption } from './pdf-images';
import type { DocumentPipeline, Prepared } from './pipeline/document-pipeline';
import {
  chequeNumberFromOcr,
  looksLikeChequeBack,
  looksLikeChequeFront,
} from './pipeline/ocr.util';
import type { ChequeRegion } from './pipeline/tool-results';

/**
 * step2 (2026-11-12, user's request): the cheques of one image found by CODE and read one
 * at a time. Used by `AttachmentProcessorService` and `scripts/bookkeeping-probe.ts`
 * (`--cv`, `--read-cheques`), so the probe runs exactly what production runs.
 *
 * Root cause it fixes (book 2, TD 4496 2024): the model drew each document's box itself and
 * drew grid guesses — one crop held cheques 00021 AND 00031, another the BACK of a third —
 * and read four cheques in one picture, giving one cheque's payee to the next or making one
 * up ("Matthew Thomas Trucking" for a cheque to Revenu Québec).
 */

/**
 * A box shrunk by `share` of its size on every side: the OCR then reads the cheque itself,
 * not the bank's caption over it ("CHEQUE # 00088" made a blank back look like a front).
 */
function inset(b: DocumentBox, share: number): DocumentBox {
  const dx = (b.x1 - b.x0) * share;
  const dy = (b.y1 - b.y0) * share;
  return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 - dx, y1: b.y1 - dy };
}

/** A cheque found: the box to cut (caption and back included) and the OCR's number. */
export interface FoundCheque {
  box: DocumentBox;
  number: string | null;
}

export interface ChequeFind {
  /** Every rectangle found, with its OCR — tool results for a whole-image read. */
  regions: ChequeRegion[];
  /** One per cheque, backs joined to their fronts; [] = not cut by code. */
  cheques: FoundCheque[];
  /** 'opencv' = OpenCV's rectangles (cut by code); 'xy-cut' = step2b's (a hint only). */
  by: 'opencv' | 'xy-cut';
  /** Rectangles were found but not all read as cheques, so nothing is cut by code. */
  notCheques?: boolean;
}

/**
 * The cheques in an image. OpenCV (`scanCheques`) finds the rectangles — a statement's
 * printed frames, or each cheque's paper in a photo — each is OCR'd for its number and
 * whether it is a BACK, and a back joins the front beside it (`pairBacks`). With fewer than
 * two rectangles, the step2b XY-cut (`chequeRegions`, tinted scans) is tried, as tool results
 * only. Null when nothing was found or OCR is off (a back cannot be told from a front then).
 */
export async function findCheques(
  file: Buffer,
  mime: string,
  pipeline: Pick<DocumentPipeline, 'enabled' | 'readImage'>,
): Promise<ChequeFind | null> {
  if (!pipeline.enabled()) return null;
  const scan = await scanCheques(file, mime);
  const rects = scan && scan.rects.length >= 2 ? scan.rects : [];
  const asBox = (r: PxRect): DocumentBox => ({
    x0: r.x / scan!.width,
    y0: r.y / scan!.height,
    x1: (r.x + r.w) / scan!.width,
    y1: (r.y + r.h) / scan!.height,
  });
  const boxes = rects.length
    ? rects.map(asBox)
    : await chequeRegions(file, mime);
  if (boxes.length < 2) return null;
  const by = rects.length ? 'opencv' : 'xy-cut';
  const regions: ChequeRegion[] = boxes.map((box) => ({
    box,
    chequeNumber: null,
    back: false,
  }));
  let crops: Buffer[];
  try {
    // Upscaled like the reads: a statement's 470 px cheque is too small for OCR to see
    // "Endorsement" / "BACK/VERSO" on a back.
    crops = await cropImage(
      file,
      mime,
      boxes.map((b) => inset(b, 0.03)),
      CHEQUE_MIN_WIDTH_PX,
    );
  } catch {
    return { regions, cheques: [], by };
  }
  const front = regions.map(() => false);
  for (let i = 0; i < crops.length; i++) {
    const ocr = await pipeline.readImage(crops[i]);
    if (!ocr) continue;
    front[i] = looksLikeChequeFront(ocr);
    regions[i].back = looksLikeChequeBack(ocr);
    // A number only off a real front — a statement's "CHEQUE/DEBIT" table read as a cheque
    // and gave its account number (#40, 2026-11-12).
    regions[i].chequeNumber =
      !regions[i].back && front[i] ? chequeNumberFromOcr(ocr) : null;
  }
  if (!rects.length) return { regions, cheques: [], by };
  // The bank's caption over each frame ("CHEQUE # 00016 $1,448.80"; over the back the same
  // number, no amount) — the surest sign of a back on a 144 dpi page, and the front's number.
  const captions = await captionsOver(file, mime, rects, scan!, pipeline);
  captions.forEach((c, i) => {
    if (c?.number && !regions[i].back) regions[i].chequeNumber ??= c.number;
  });
  rects.forEach((r, i) => {
    const prev = i > 0 ? captions[i - 1] : null;
    const mine = captions[i];
    if (
      i > 0 &&
      sameRow(rects[i - 1], r) &&
      prev?.number &&
      prev.amount !== null &&
      mine?.number === prev.number &&
      mine.amount === null
    ) {
      regions[i].back = true;
      regions[i].chequeNumber = null;
    }
  });
  // The page's layout settles the backs OCR could not see (`backColumn`).
  const backs = backColumn(
    rects,
    regions.map((r) => r.back),
    regions.map((r) => !!r.chequeNumber),
  );
  backs.forEach((b, i) => (regions[i].back = b));
  // Only OpenCV's rectangles are cut by code; the XY-cut stays a hint (step2e).
  const pairs = pairBacks(rects, backs);
  // step2 (2026-11-12): and only when EVERY front reads as a cheque (a number, the bank's
  // caption, a MICR line or "pay to the order of") — OpenCV also boxes a statement page's
  // tables, which were cut into "documents" (the step2b rule, restored).
  const allCheques = pairs.every((c) => {
    const i = rects.indexOf(c.front);
    return !!regions[i].chequeNumber || !!captions[i]?.number || front[i];
  });
  const cheques = allCheques
    ? pairs.map((c) => ({
        box: cutBox(c, rects, scan!.width, scan!.height),
        number: regions[rects.indexOf(c.front)].chequeNumber,
      }))
    : [];
  return { regions, cheques, by, notCheques: !allCheques };
}

/**
 * Code reads the cheques one by one when it found several — or one with its BACK beside it:
 * read whole, the back came back as a second document ("DOCUMENT" with nothing on it).
 */
export function readAlone(found: ChequeFind): boolean {
  return (
    found.cheques.length >= 2 ||
    (found.cheques.length === 1 && found.regions.some((r) => r.back))
  );
}

/** The band just above each frame, OCR'd and parsed as a bank's caption (null = none). */
async function captionsOver(
  file: Buffer,
  mime: string,
  rects: readonly PxRect[],
  scan: { width: number; height: number },
  pipeline: Pick<DocumentPipeline, 'readImage'>,
): Promise<Array<Caption | null>> {
  const bands = rects.map(
    (r): DocumentBox => ({
      x0: r.x / scan.width,
      y0: Math.max(0, r.y - r.h * 0.18) / scan.height,
      x1: (r.x + r.w) / scan.width,
      y1: r.y / scan.height,
    }),
  );
  const out: Array<Caption | null> = rects.map(() => null);
  if (bands.every((b) => b.y1 - b.y0 <= 0)) return out;
  let crops: Buffer[];
  try {
    crops = await cropImage(file, mime, bands, CHEQUE_MIN_WIDTH_PX);
  } catch {
    return out;
  }
  for (let i = 0; i < crops.length; i++) {
    if (bands[i].y1 - bands[i].y0 <= 0) continue;
    const ocr = await pipeline.readImage(crops[i]);
    const caption = ocr ? parseCaption(ocr.text) : null;
    out[i] = caption?.number ? caption : null;
  }
  return out;
}

/**
 * Said with each cheque cut out of an image, read on its own. One call per cheque: reading
 * four in one picture, the model gave one cheque's payee to the next.
 */
export const ONE_CHEQUE_HINT =
  '\n\nThis image is ONE cheque, cut out of a bigger image by our tools (its back may be ' +
  'beside it — part of the same cheque, never a second document). Return exactly one ' +
  'document. Read the payee, the amount, the date and the memo from THIS cheque only. A ' +
  'caption printed over it by the bank ("CHEQUE # 00021 $2,318.08") is its number and ' +
  "amount. The date is the one written on the cheque's front, never a deposit date stamped " +
  'on its back. A payee or date you cannot read is null — never a guess.';

/** A cheque cut for reading is rendered at least this wide (the vision model's detail). */
export const CHEQUE_MIN_WIDTH_PX = 1400;

/**
 * Each cheque cut out and read ON ITS OWN (one vision call each, `ONE_CHEQUE_HINT`, its own
 * OCR as tool results); a reading carries its cut box, so the processor stores one file per
 * cheque. `only` = a sibling re-read: just that cheque (the array keeps its index). Null when
 * the cut fails or a read comes back empty — the whole image is then read as before.
 */
export async function readChequesAlone(input: {
  file: Buffer;
  mime: string;
  cheques: readonly FoundCheque[];
  extractor: Pick<AttachmentExtractor, 'read'>;
  pipeline: Pick<DocumentPipeline, 'prepare'> | null;
  filename: string;
  today: string;
  message: string | null;
  hints: string;
  only?: number | null;
  /** The OCR's cheque number kept beside the AI's (the processor's `withOcrChequeNumber`). */
  withOcr?: (r: AttachmentReading, p: Prepared | null) => AttachmentReading;
}): Promise<AttachmentReading[] | null> {
  const { cheques, only = null } = input;
  let crops: Buffer[];
  try {
    crops = await cropImage(
      input.file,
      input.mime,
      cheques.map((c) => c.box),
      CHEQUE_MIN_WIDTH_PX,
    );
  } catch {
    return null;
  }
  const readings = new Array<AttachmentReading>(cheques.length);
  for (let i = 0; i < cheques.length; i++) {
    if (only !== null && i !== only) continue;
    const prepared =
      (await input.pipeline?.prepare(crops[i], 'image/png', 'image')) ?? null;
    const [first] = await input.extractor.read(
      crops[i],
      `${input.filename.slice(0, 200)} (cheque ${i + 1} of ${cheques.length})`,
      'image/png',
      'image',
      input.today,
      input.message,
      input.hints + ONE_CHEQUE_HINT,
      prepared,
      [],
    );
    if (!first) return null;
    const reading = { ...first, box: cheques[i].box };
    readings[i] = input.withOcr ? input.withOcr(reading, prepared) : reading;
  }
  return readings;
}
