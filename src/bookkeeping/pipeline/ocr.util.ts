/**
 * step2 (2026-11-08): the pure rules over what PaddleOCR read (`ocr.service.ts`) — whether
 * it is good enough to hand the AI as TEXT (the cheap text model) or the file must go to the
 * vision model as before, whether it is a cheque, and the cheque's number. Pure + spec.
 */

/** One word / phrase box PaddleOCR found, in the image's own pixels. */
export interface OcrBox {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One printed / written line: its boxes left to right. `confidence` = its weakest box. */
export interface OcrLine {
  text: string;
  confidence: number;
  boxes: OcrBox[];
}

/** Which engine read it (`OCR_ENGINE`). Tesseract reads printed text only, no handwriting. */
export type OcrEngineName = 'tesseract' | 'paddle';

export interface OcrResult {
  text: string;
  /** The engine's own average over the whole read, 0–1. */
  confidence: number;
  lines: OcrLine[];
  /** The image's size in pixels (the boxes' space). */
  width: number;
  height: number;
  /** Unset = paddle (results built before step2c). */
  engine?: OcrEngineName;
}

/** Below this a line (or the whole read) is a guess, not a reading. */
export const MIN_LINE_CONFIDENCE = 0.85;
export const MIN_TEXT_CONFIDENCE = 0.88;
/** Fewer letters / digits than this is not a document, whatever the confidence. */
const MIN_CHARS = 15;

/** 1,234.56 · 1234.56 · 1 234,56 · $ 45.00 · **450.00 — a figure with cents. */
const MONEY = /\d[\d,\s]*[.,]\d{2}(?!\d)/;
/**
 * Word boundaries are lookarounds on letters, not `\b`: JavaScript's `\b` is ASCII-only, so
 * it never fires next to "à" or "é" and the French wording ("Payez à l'ordre de") was missed.
 */
const CHEQUE_WORDS =
  /(?<![\p{L}\p{N}])(pay\s+to\s+the\s+order|order\s+of|payez\s+[àa]|à\s+l['’]ordre|pay\s*\/\s*payez|dollars|cheque|chèque|check\s*no|memo|mémo|non[-\s]?négociable|void\s+after)(?![\p{L}\p{N}])/iu;
/** MICR transit / on-us symbols as PaddleOCR renders them (boxes, ⑆ ⑈ ⑉, or a bare "|:"). */
const MICR_SYMBOLS = /[⑆⑇⑈⑉□☐■▯|]/;

const chars = (s: string): number => s.replace(/[^\p{L}\p{N}]/gu, '').length;

/** The MICR line: bottom of the cheque, mostly digits, with its symbols or 3+ digit groups. */
export function micrLine(r: OcrResult): OcrLine | null {
  const height = r.height;
  const bottom = r.lines.filter((l) =>
    l.boxes.some((b) => b.y >= height * 0.65),
  );
  for (const l of bottom.reverse()) {
    const digits = l.text.replace(/\D/g, '').length;
    const groups = (l.text.match(/\d{3,}/g) ?? []).length;
    if (digits >= 12 && (MICR_SYMBOLS.test(l.text) || groups >= 3)) return l;
  }
  return null;
}

/** True when the text reads like a cheque (its printed wording, or a MICR line). */
export function looksLikeChequeText(r: OcrResult): boolean {
  return CHEQUE_WORDS.test(r.text) || micrLine(r) !== null;
}

/**
 * The cheque's number (digits, leading zeros kept) — the number printed top-right ("No.
 * 001234", "1042"), confirmed by the MICR line when both exist. A number only on the MICR
 * line is used when it stands alone there as the cheque field (Canada prints it first, the
 * US last; the routing / account fields are longer). Null when nothing is sure.
 */
export function chequeNumberFromOcr(r: OcrResult): string | null {
  const { width, height } = r;
  const micr = micrLine(r);
  const micrGroups = (micr?.text.match(/\d+/g) ?? []).map((g) =>
    g.replace(/^0+/, ''),
  );
  // Top-right: a 3–8 digit number in the top 40%, right 45% of the cheque.
  const topRight: string[] = [];
  for (const line of r.lines) {
    for (const b of line.boxes) {
      if (b.y > height * 0.4 || b.x + b.width < width * 0.55) continue;
      if (b.confidence < MIN_LINE_CONFIDENCE) continue;
      // A date or an amount is not a cheque number.
      if (MONEY.test(b.text) || /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(b.text))
        continue;
      for (const n of b.text.match(/\b\d{3,8}\b/g) ?? []) topRight.push(n);
    }
  }
  const confirmed = topRight.find((n) =>
    micrGroups.includes(n.replace(/^0+/, '')),
  );
  if (confirmed) return confirmed;
  if (topRight.length === 1) return topRight[0];
  // MICR only: the one short (3–6 digit) field; routing (5+3 / 9) and accounts are longer
  // or come in pairs.
  const short = (micr?.text.match(/\d+/g) ?? []).filter(
    (g) => g.length >= 3 && g.length <= 6 && g.replace(/^0+/, '').length >= 1,
  );
  return micr && micr.confidence >= MIN_LINE_CONFIDENCE && short.length === 1
    ? short[0]
    : null;
}

/** "For deposit only", an endorsement, a bank's stamp: what a cheque's BACK says. */
const BACK_WORDS =
  /(?<![\p{L}\p{N}])(endorse|endorsement|endossement|for\s+deposit|deposit\s+only|pour\s+d[ée]p[ôo]t|do\s+not\s+write|ne\s+pas\s+[ée]crire|sign\s+here|back\s*\/\s*verso|negotiating\s+institution)(?![\p{L}\p{N}])/iu;

/** Printed on a cheque's back only: TD's "BACK/VERSO", the negotiating bank's stamp block. */
const BACK_ONLY =
  /(?<![\p{L}\p{N}])(back\s*\/\s*verso|negotiating\s+institution|endorsement\s*-\s*signature)(?![\p{L}\p{N}])/iu;

/**
 * A cheque's BACK (or a blank strip): not cheque wording, no amount and no MICR line — an
 * endorsement, a deposit stamp, or almost nothing. It is kept with its front, never filed
 * as a cheque of its own.
 */
export function looksLikeChequeBack(r: OcrResult): boolean {
  // step2 (2026-11-12): what only a back prints wins, even beside the bank's "CHEQUE # 00021"
  // caption (a TD back's crop carries it, and "cheque" alone made it a front).
  if (BACK_ONLY.test(r.text)) return true;
  if (looksLikeChequeText(r) || MONEY.test(r.text)) return false;
  return BACK_WORDS.test(r.text) || chars(r.text) < 40;
}

/**
 * Two documents side by side (two receipts in one photo): OCR merges their lines across the
 * gap, so its text would mix them. Several lines with a gap wider than a quarter of the image
 * between two boxes = side by side → the vision model reads it (it can tell them apart).
 */
export function sideBySide(r: OcrResult): boolean {
  const width = r.width;
  let wide = 0;
  for (const l of r.lines) {
    const boxes = [...l.boxes].sort((a, b) => a.x - b.x);
    for (let i = 1; i < boxes.length; i++) {
      const gap = boxes[i].x - (boxes[i - 1].x + boxes[i - 1].width);
      if (gap > width * 0.25) {
        wide++;
        break;
      }
    }
  }
  return wide >= 3;
}

/** The words a cheque's payee line starts with — once per cheque. */
const PAYEE_ANCHOR =
  /(?<![\p{L}\p{N}])(pay\s+to\s+the\s+order\s+of|payez\s+[àa]\s+l['’]ordre\s+de|à\s+l['’]ordre\s+de)(?![\p{L}\p{N}])/giu;

/**
 * More than one cheque in the text: two payee lines, or two MICR lines. OCR merges two
 * cheques printed side by side into one line ("ACME No. 2001 ACME No. 2002"), so its text
 * would mix them — the vision model reads such an image (it can tell them apart and box them).
 */
export function severalCheques(r: OcrResult): boolean {
  const anchors = (r.text.match(PAYEE_ANCHOR) ?? []).length;
  const micr = r.lines.filter((l) => {
    const digits = l.text.replace(/\D/g, '').length;
    return (
      digits >= 12 &&
      (MICR_SYMBOLS.test(l.text) || (l.text.match(/\d{3,}/g) ?? []).length >= 3)
    );
  }).length;
  return anchors >= 2 || micr >= 2;
}

export type OcrVerdict =
  | { ok: true; cheque: boolean }
  | { ok: false; cheque: boolean; reason: string };

/**
 * Whether PaddleOCR's text is enough for the AI to read the file as TEXT (user's rule:
 * "if it has problems reading something it should pass it to the model"):
 * - enough text, read with high confidence overall;
 * - not two documents side by side;
 * - a cheque only when its NUMBER, its AMOUNT and its PAYEE line were each read surely —
 *   else the vision model reads the handwriting itself, with this text as a hint.
 */
export function ocrGate(r: OcrResult | null): OcrVerdict {
  if (!r) return { ok: false, cheque: false, reason: 'no OCR' };
  const cheque = looksLikeChequeText(r);
  if (chars(r.text) < MIN_CHARS)
    return { ok: false, cheque, reason: 'too little text' };
  if (r.confidence < MIN_TEXT_CONFIDENCE)
    return {
      ok: false,
      cheque,
      reason: `low confidence ${r.confidence.toFixed(2)}`,
    };
  // A cheque's amount and payee are handwritten, and Tesseract cannot read handwriting (it
  // can be sure of a wrong guess): the vision model reads the cheque, this text is a hint.
  if (cheque && r.engine === 'tesseract')
    return { ok: false, cheque, reason: 'cheque handwriting (Tesseract)' };
  if (sideBySide(r))
    return { ok: false, cheque, reason: 'documents side by side' };
  if (cheque && severalCheques(r))
    return { ok: false, cheque, reason: 'several cheques in one image' };
  if (cheque) {
    if (!chequeNumberFromOcr(r))
      return { ok: false, cheque, reason: 'cheque number not read' };
    const amount = r.lines.some(
      (l) => MONEY.test(l.text) && l.confidence >= MIN_LINE_CONFIDENCE,
    );
    if (!amount)
      return { ok: false, cheque, reason: 'cheque amount not read surely' };
    const payee = r.lines.find((l) =>
      /(?<![\p{L}\p{N}])(order\s+of|payez|l['’]ordre|pay)(?![\p{L}\p{N}])/iu.test(
        l.text,
      ),
    );
    // The payee is written after the printed words, on the same line.
    const written = payee?.text
      .replace(
        /.*(?<![\p{L}\p{N}])(order\s+of|payez\s+[àa]|l['’]ordre\s+de|pay)(?![\p{L}\p{N}])/iu,
        '',
      )
      .trim();
    if (!payee || !written || chars(written) < 2)
      return { ok: false, cheque, reason: 'payee not read' };
    if (payee.confidence < MIN_LINE_CONFIDENCE)
      return { ok: false, cheque, reason: 'payee not read surely' };
  }
  return { ok: true, cheque };
}

/**
 * The text handed to the AI: one OCR line per line, top to bottom, with each line's
 * confidence when it is unsure — so the model knows which words to doubt.
 */
export function ocrText(r: OcrResult): string {
  return r.lines
    .map((l) =>
      l.confidence < MIN_LINE_CONFIDENCE
        ? `${l.text}   [unsure ${Math.round(l.confidence * 100)}%]`
        : l.text,
    )
    .join('\n');
}
