import type { DocumentBox } from './attachment-extractor';

/**
 * step2 (2026-11-08): cut an image holding SEVERAL cheques into one region per cheque BY CODE,
 * before any AI reads it. The step9 way (the AI draws a box around each document, `cropPlan`)
 * kept failing on statement cheque pages — the model often gave one document for two cheques,
 * or no boxes, and both cheques then landed on one transaction (customer's complaint, step2.md).
 *
 * How: a recursive XY-cut over the image's "paper" — every pixel that is not page-white
 * counts (a scanned cheque has a tinted / textured background, the gaps between cheques are
 * page-white). A blank band across the whole block splits it in two; a split is kept only when
 * BOTH sides are themselves cheques (cheque-shaped) or split further into cheques, so the white
 * space INSIDE a cheque (between its printed lines) never cuts it: half a cheque is a strip,
 * not cheque-shaped. Pure (`splitRegions`), unit-tested; `chequeRegions` renders the image with
 * mupdf (no sharp on the host). One region (or none) = not split here — the old path decides.
 */

/** A rectangle in pixels of the analysed image, [x0, y0) – [x1, y1). */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** width / height of a cheque, generously: personal 2.2, business 2.4, a scan with margin. */
const MIN_ASPECT = 1.5;
const MAX_ASPECT = 3.8;
/** A cheque is at least this share of the image's area (a logo or a stamp is not). */
const MIN_AREA_SHARE = 0.04;
/** A gap must be at least this many pixels (and 1% of the block) to separate two cheques. */
const MIN_GAP_PX = 4;
/** A row / column with this share of non-white pixels or fewer is blank (scan noise). */
const BLANK_SHARE = 0.004;
/** Gaps tried per axis per block, widest first. */
const MAX_GAPS = 8;
const MAX_DEPTH = 6;
/** Blocks examined per image at most — a page of text has many gaps; past it, no split. */
const MAX_STEPS = 600;
/**
 * A cheque region must be mostly PAPER (a scan's tinted or textured background), not a few
 * lines of text with white around them: below this fill, a block is never a cheque. A cheque
 * printed on pure white, with only a thin border, therefore never splits here — it is left to
 * the AI's boxes (the old path) rather than risk cutting it along its own white space.
 */
const MIN_FILL = 0.5;

const w = (b: PixelBox) => b.x1 - b.x0;
const h = (b: PixelBox) => b.y1 - b.y0;

/**
 * The cheques on an ink map (1 = not page-white), top to bottom then left to right; [] when
 * there are fewer than two. Pure.
 */
export function splitRegions(
  ink: Uint8Array,
  width: number,
  height: number,
): PixelBox[] {
  const imageArea = width * height;
  const at = (x: number, y: number) => ink[y * width + x];
  // Summed-area table: the ink inside any box in O(1).
  const W = width + 1;
  const sat = new Uint32Array(W * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += ink[y * width + x];
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row;
    }
  }
  const inkIn = (b: PixelBox) =>
    sat[b.y1 * W + b.x1] -
    sat[b.y0 * W + b.x1] -
    sat[b.y1 * W + b.x0] +
    sat[b.y0 * W + b.x0];

  const rowInk = (b: PixelBox, y: number) => {
    let n = 0;
    for (let x = b.x0; x < b.x1; x++) n += at(x, y);
    return n;
  };
  const colInk = (b: PixelBox, x: number) => {
    let n = 0;
    for (let y = b.y0; y < b.y1; y++) n += at(x, y);
    return n;
  };

  /** The block shrunk to its paper; null when it holds none. */
  const trim = (b: PixelBox): PixelBox | null => {
    const rowBlank = (y: number) => rowInk(b, y) <= w(b) * BLANK_SHARE;
    const colBlank = (x: number) => colInk(b, x) <= h(b) * BLANK_SHARE;
    let { x0, y0, x1, y1 } = b;
    while (y0 < y1 && rowBlank(y0)) y0++;
    while (y1 > y0 && rowBlank(y1 - 1)) y1--;
    const t = { x0, y0, x1, y1 };
    while (t.x0 < t.x1 && colBlank(t.x0)) t.x0++;
    while (t.x1 > t.x0 && colBlank(t.x1 - 1)) t.x1--;
    ({ x0, x1 } = t);
    return x1 - x0 > 0 && y1 - y0 > 0 ? { x0, y0, x1, y1 } : null;
  };

  const chequeShaped = (b: PixelBox) => {
    const aspect = w(b) / h(b);
    return (
      aspect >= MIN_ASPECT &&
      aspect <= MAX_ASPECT &&
      w(b) * h(b) >= imageArea * MIN_AREA_SHARE &&
      inkIn(b) >= w(b) * h(b) * MIN_FILL
    );
  };

  /** Interior blank bands of a block along one axis: [start, end) of each, widest first. */
  const gaps = (b: PixelBox, axis: 'y' | 'x'): Array<[number, number]> => {
    const from = axis === 'y' ? b.y0 : b.x0;
    const to = axis === 'y' ? b.y1 : b.x1;
    const span = axis === 'y' ? w(b) : h(b);
    const minGap = Math.max(MIN_GAP_PX, Math.round((to - from) * 0.01));
    const out: Array<[number, number]> = [];
    let start = -1;
    for (let i = from; i < to; i++) {
      const blank =
        (axis === 'y' ? rowInk(b, i) : colInk(b, i)) <= span * BLANK_SHARE;
      if (blank && start < 0) start = i;
      if (!blank && start >= 0) {
        if (i - start >= minGap && start > from) out.push([start, i]);
        start = -1;
      }
    }
    return out.sort((a, c) => c[1] - c[0] - (a[1] - a[0])).slice(0, MAX_GAPS);
  };

  let steps = 0;
  /** The cheques in a block, or null when it is neither a cheque nor a set of them. */
  const solve = (block: PixelBox, depth: number): PixelBox[] | null => {
    if (++steps > MAX_STEPS) return null;
    const b = trim(block);
    if (!b) return null;
    if (depth < MAX_DEPTH) {
      for (const axis of ['y', 'x'] as const) {
        for (const [g0, g1] of gaps(b, axis)) {
          const first = axis === 'y' ? { ...b, y1: g0 } : { ...b, x1: g0 };
          const second = axis === 'y' ? { ...b, y0: g1 } : { ...b, x0: g1 };
          const a = solve(first, depth + 1);
          if (!a) continue;
          const c = solve(second, depth + 1);
          if (!c) continue;
          return [...a, ...c];
        }
      }
    }
    return chequeShaped(b) ? [b] : null;
  };

  // The whole image may hold a cheque plus other things (a statement's header line, a page
  // number): those blocks are dropped, as long as two or more cheques remain.
  const found = collect(
    { x0: 0, y0: 0, x1: width, y1: height },
    solve,
    trim,
    gaps,
  );
  return found.length >= 2 && steps <= MAX_STEPS
    ? found.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    : [];
}

/**
 * Like `solve`, but tolerant at the top: a block that is neither a cheque nor a set of them
 * (a header line, a page footer) is dropped instead of failing everything above it.
 */
function collect(
  block: PixelBox,
  solve: (b: PixelBox, depth: number) => PixelBox[] | null,
  trim: (b: PixelBox) => PixelBox | null,
  gaps: (b: PixelBox, axis: 'y' | 'x') => Array<[number, number]>,
  depth = 0,
): PixelBox[] {
  const whole = solve(block, depth);
  if (whole) return whole;
  const b = trim(block);
  if (!b || depth >= 3) return [];
  // Cut at every interior gap of the longer axis and keep what each piece holds.
  for (const axis of h(b) >= w(b)
    ? (['y', 'x'] as const)
    : (['x', 'y'] as const)) {
    const cuts = gaps(b, axis).sort((a, c) => a[0] - c[0]);
    if (!cuts.length) continue;
    const pieces: PixelBox[] = [];
    let start = axis === 'y' ? b.y0 : b.x0;
    for (const [g0, g1] of cuts) {
      pieces.push(
        axis === 'y'
          ? { ...b, y0: start, y1: g0 }
          : { ...b, x0: start, x1: g0 },
      );
      start = g1;
    }
    pieces.push(axis === 'y' ? { ...b, y0: start } : { ...b, x0: start });
    const out = pieces.flatMap((p) => collect(p, solve, trim, gaps, depth + 1));
    if (out.length) return out;
  }
  return [];
}

/**
 * Page-white is read off the image: its 99th-percentile grey (the gaps between cheques are
 * the brightest thing on a statement page). A pixel more than `WHITE_MARGIN` darker is paper
 * or ink. A fixed cut-off missed lightly tinted cheque paper (~237 grey). An image with no
 * bright background at all (a photo on a table) is not split.
 */
const WHITE_MARGIN = 8;
const MIN_WHITE = 200;
/** The image is analysed at most this wide (the regions are fractions, so size is free). */
const ANALYSE_WIDTH = 1000;

/** The 99th-percentile grey of a one-channel pixmap. Pure. */
export function pageWhite(
  px: ArrayLike<number>,
  width: number,
  height: number,
  stride = width,
): number {
  const hist = new Uint32Array(256);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) hist[px[y * stride + x]]++;
  let left = Math.ceil(width * height * 0.01);
  for (let v = 255; v >= 0; v--) {
    left -= hist[v];
    if (left <= 0) return v;
  }
  return 0;
}

/**
 * The cheque regions of an image, as fractions of its size (the reader's `box` format, so
 * `cropImage` cuts them). [] when fewer than two are found or the image cannot be opened.
 * ⚠️ mupdf is ESM + WASM — see `pdf-decrypt.ts`.
 */
export async function chequeRegions(
  file: Buffer,
  mimeType: string,
): Promise<DocumentBox[]> {
  try {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(file, mimeType);
    try {
      const page = doc.loadPage(0);
      try {
        const [x0, , x1] = page.getBounds();
        const scale = Math.min(1, ANALYSE_WIDTH / Math.max(1, x1 - x0)) || 1;
        // The whole page, so the pixmap is exactly the image (its origin does not matter).
        const pix = page.toPixmap(
          [scale, 0, 0, scale, 0, 0],
          mupdf.ColorSpace.DeviceGray,
          false,
        );
        try {
          const width = pix.getWidth();
          const height = pix.getHeight();
          const stride = pix.getStride();
          const px = pix.getPixels();
          const white = pageWhite(px, width, height, stride);
          if (white < MIN_WHITE) return [];
          const ink = new Uint8Array(width * height);
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              ink[y * width + x] =
                px[y * stride + x] < white - WHITE_MARGIN ? 1 : 0;
            }
          }
          return splitRegions(ink, width, height).map((r) => ({
            x0: r.x0 / width,
            y0: r.y0 / height,
            x1: r.x1 / width,
            y1: r.y1 / height,
          }));
        } finally {
          pix.destroy();
        }
      } finally {
        page.destroy();
      }
    } finally {
      doc.destroy();
    }
  } catch {
    return [];
  }
}
