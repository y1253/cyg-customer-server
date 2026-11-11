import type { Prepared } from './document-pipeline';

/**
 * step2e (2026-11-10, user's rule): "the tools should help the model, not the opposite". The
 * local tools (OCR, a PDF's text layer, the code's cheque regions) never stand in for the
 * model any more: the model always gets the FILE, and what the tools found goes along as
 * TOOL RESULTS that narrow its error margin. Where they disagree with the file, the file wins.
 * Since step2b, the text-only reads, the code-cut cheques and the OCR number overriding the
 * model's had made the errors go up. Pure.
 */

/** A cheque-shaped region the code found in an image (`chequeRegions`), with its OCR. */
export interface ChequeRegion {
  /** Fractions of the image (the reader's `box` format). */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** The number OCR read off it (printed top-right / MICR line); null = none read. */
  chequeNumber: string | null;
  /** OCR read it as the BACK of a cheque (an endorsement: no amount, no number). */
  back: boolean;
}

/** The tools' text given to the model at most (an invoice or a page fits). */
export const TOOL_TEXT_CHARS = 8000;

const TOOLS_HEADER =
  'TOOL RESULTS: our own tools read this file before you. They are a help, not the ' +
  'answer: use them to check every number, name and date you read, and look again ' +
  'wherever they disagree with what you see. The FILE always wins. Text the tools could ' +
  'not read (handwriting, other alphabets such as Yiddish or Hebrew, a photo) you read ' +
  'yourself from the file.';

const SOURCE_LABEL: Record<Prepared['source'], string> = {
  OCR: 'OCR',
  PDF_TEXT: "the PDF's own text layer",
  SHEET: "the spreadsheet's cells",
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The TOOL RESULTS block appended to the reader's user message ('' when the tools found
 * nothing): what read the file and how surely, the OCR's cheque number, the cheque regions,
 * and the text with `[unsure NN%]` lines marked.
 */
export function toolResultsHint(
  prepared: Prepared | null,
  regions: readonly ChequeRegion[] = [],
): string {
  const lines: string[] = [];
  if (prepared) {
    const sure =
      prepared.confidence != null
        ? `, overall confidence ${Math.round(prepared.confidence * 100)}%`
        : '';
    const doubt = prepared.reason ? ` (it was unsure: ${prepared.reason})` : '';
    lines.push(`- Read by ${SOURCE_LABEL[prepared.source]}${sure}${doubt}.`);
    if (prepared.chequeNumber) {
      lines.push(
        `- Cheque number OCR read off the printed number / MICR line: ${prepared.chequeNumber}.`,
      );
    }
  }
  if (regions.length) {
    lines.push(
      `- ${regions.length} cheque-shaped regions found in the image (x0, y0, x1, y1 as fractions ` +
        'of its width and height). Decide yourself how many documents there are and where ' +
        'each one is:',
      ...regions.map(
        (r, i) =>
          `  ${i + 1}. (${round(r.box.x0)}, ${round(r.box.y0)}, ${round(r.box.x1)}, ${round(r.box.y1)})` +
          (r.back
            ? ' reads like the BACK of a cheque'
            : r.chequeNumber
              ? `, cheque number ${r.chequeNumber}`
              : ''),
      ),
    );
  }
  const text = prepared?.text.trim();
  if (text) {
    lines.push(
      '- Text read off it (laid out as printed; a line marked [unsure NN%] was a weak read):',
      `"""\n${text.slice(0, TOOL_TEXT_CHARS)}\n"""`,
    );
  }
  return lines.length ? `\n\n${TOOLS_HEADER}\n${lines.join('\n')}` : '';
}

/** A statement page's own text layer, as tool results for the model reading the PDF page. */
export function pageTextHint(text: string): string {
  return (
    `${TOOLS_HEADER}\n- This page's text layer (every line as printed, columns kept with ` +
    `spaces):\n"""\n${text.slice(0, TOOL_TEXT_CHARS * 2)}\n"""`
  );
}
