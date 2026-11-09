/**
 * step2 (2026-11-08): a PDF's own text layer, laid out as it is printed — the first reader of
 * every PDF (statements included, behind `STATEMENT_TEXT_PIPELINE`). mupdf (already used for
 * decrypting / cutting) gives each line with its position; lines on the same baseline become
 * ONE row and each keeps its column by padding with spaces, so a statement's Debit / Credit /
 * Balance columns survive (the plain text layer loses them — `sign-repair.ts`).
 *
 * The rules over the text are pure (`layoutRows`, `pdfTextQuality`) + spec; only
 * `pdfPageTexts` touches mupdf. ⚠️ mupdf is ESM + WASM — see `pdf-decrypt.ts`.
 */

/** One piece of text mupdf placed on the page: left edge, baseline, font size (points). */
export interface TextPiece {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

/**
 * The page as monospaced rows: pieces on the same baseline (within ~40% of the font size)
 * are one row, left to right, each starting at its column (x / an average character's
 * width). A piece that would overlap the one before keeps one space after it.
 */
export function layoutRows(pieces: readonly TextPiece[]): string {
  const list = pieces.filter((p) => p.text.trim());
  if (!list.length) return '';
  const sizes = list.map((p) => p.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 10;
  // An average character is about half the font size wide.
  const charW = Math.max(2, median * 0.5);
  const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: TextPiece[][] = [];
  for (const p of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - p.y) <= Math.max(2, median * 0.4))
      row.push(p);
    else rows.push([p]);
  }
  const minX = Math.min(...list.map((p) => p.x));
  return rows
    .map((row) => {
      let line = '';
      for (const p of row.sort((a, b) => a.x - b.x)) {
        const col = Math.max(0, Math.round((p.x - minX) / charW));
        if (line.length && col <= line.length) line += ' ';
        else line = line.padEnd(col, ' ');
        // Runs of spaces INSIDE a piece are layout too (a line printed as one string).
        line += p.text.replace(/[\t\r\n]/g, ' ').trim();
      }
      return line.trimEnd();
    })
    .join('\n');
}

export interface TextQuality {
  ok: boolean;
  reason: string | null;
}

/** Letters / digits a page must have to count as read (a scan has (almost) none). */
const MIN_CHARS = 40;

/**
 * Whether a PDF's text layer can stand in for the file. Refused: a scan (too little text),
 * fonts with no Unicode map (U+FFFD, "(cid:12)", private-use glyphs), or text that is mostly
 * symbols — the model then reads the file itself, as before. Pure.
 */
export function pdfTextQuality(text: string): TextQuality {
  const solid = text.replace(/\s/g, '');
  const real = solid.replace(/[^\p{L}\p{N}]/gu, '').length;
  if (real < MIN_CHARS) return { ok: false, reason: 'no text layer' };
  const broken =
    (solid.match(/[�-]/g) ?? []).length +
    (text.match(/\(cid:\d+\)/g) ?? []).length * 6;
  if (broken / solid.length > 0.02)
    return { ok: false, reason: 'fonts without a text map' };
  if (real / solid.length < 0.45)
    return { ok: false, reason: 'mostly symbols' };
  return { ok: true, reason: null };
}

/** Each page's laid-out text (0-based), '' for a page mupdf cannot read. Null = no file. */
export async function pdfPageTexts(pdf: Buffer): Promise<string[] | null> {
  try {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
    try {
      if (doc.needsPassword()) return null;
      const out: string[] = [];
      const count = doc.countPages();
      for (let i = 0; i < count; i++) {
        const page = doc.loadPage(i);
        try {
          const st = page.toStructuredText('preserve-whitespace');
          try {
            out.push(layoutRows(piecesOf(st.asJSON())));
          } finally {
            st.destroy();
          }
        } catch {
          out.push('');
        } finally {
          page.destroy();
        }
      }
      return out;
    } finally {
      doc.destroy();
    }
  } catch {
    return null;
  }
}

interface StextJson {
  blocks?: Array<{
    type?: string;
    lines?: Array<{
      wmode?: number;
      bbox?: { x: number; y: number; w: number; h: number };
      font?: { size?: number };
      x?: number;
      y?: number;
      text?: string;
    }>;
  }>;
}

/** mupdf's structured-text JSON → pieces. Vertical text (wmode 1) is left out. */
export function piecesOf(json: string): TextPiece[] {
  const parsed = JSON.parse(json) as StextJson;
  const out: TextPiece[] = [];
  for (const block of parsed.blocks ?? []) {
    if (block.type && block.type !== 'text') continue;
    for (const line of block.lines ?? []) {
      if (line.wmode === 1 || !line.text) continue;
      const box = line.bbox ?? { x: line.x ?? 0, y: line.y ?? 0, w: 0, h: 0 };
      out.push({
        text: line.text,
        x: line.x ?? box.x,
        y: line.y ?? box.y + box.h,
        width: box.w,
        size: line.font?.size ?? box.h ?? 10,
      });
    }
  }
  return out;
}
