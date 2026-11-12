import { Logger } from '@nestjs/common';
import { chequeRects, inReadingOrder, type PxRect } from './cheque-vision.util';

/**
 * step2 (2026-11-12, user's request): OpenCV finds the cheques in an image — the frames a
 * bank prints around each cheque image (TD's statement pages: 4 cheques, front | back) and,
 * in a photo, the paper of each cheque against the table. The model was drawing those boxes
 * itself and drew grid guesses: one crop held two cheques, another the back of a third.
 *
 * OpenCV is `@techstark/opencv-js` — OpenCV compiled to WASM, pure JS: no native build (it
 * survives `npm ci` on the host, unlike onnxruntime's binaries) and no Python. Loaded once,
 * lazily, on the first image (~0.6 s, +30–40 MB RSS); 90–300 ms per page. The image is
 * decoded by mupdf (already used for crops — no sharp on the host). One image at a time.
 * Never throws: OpenCV not loading = no boxes (logged once), never a crash.
 *
 * ⚠️ mupdf is ESM + WASM, loaded with a real dynamic `import()` — see `pdf-decrypt.ts`.
 */

/** The image is analysed at most this wide (boxes are fractions, so size is free). */
const ANALYSE_WIDTH = 1600;
const LOAD_TIMEOUT_MS = 30_000;
/** White pixels added on every side before tracing outlines. */
const PAD = 8;

const logger = new Logger('ChequeVision');

/** The parts of OpenCV.js used here (its own typings are loose). */
interface Mat {
  data: Uint8Array;
  delete(): void;
}
interface MatVector {
  size(): number;
  get(i: number): Mat;
  delete(): void;
}
interface Cv {
  Mat: new (...args: unknown[]) => Mat;
  MatVector: new () => MatVector;
  Size: new (w: number, h: number) => unknown;
  CV_8UC1: number;
  ADAPTIVE_THRESH_MEAN_C: number;
  THRESH_BINARY_INV: number;
  RETR_LIST: number;
  RETR_EXTERNAL: number;
  CHAIN_APPROX_SIMPLE: number;
  MORPH_RECT: number;
  adaptiveThreshold(...args: unknown[]): void;
  findContours(...args: unknown[]): void;
  boundingRect(c: Mat): { x: number; y: number; width: number; height: number };
  contourArea(c: Mat): number;
  convexHull(...args: unknown[]): void;
  arcLength(c: Mat, closed: boolean): number;
  Canny(...args: unknown[]): void;
  dilate(...args: unknown[]): void;
  getStructuringElement(shape: number, size: unknown): Mat;
  onRuntimeInitialized?: () => void;
}

let loading: Promise<{ cv: Cv } | null> | null = null;

/**
 * OpenCV, loaded once; null when it cannot load here (logged once).
 * ⚠️ The module object is a THENABLE (Emscripten's `then`): resolving a promise WITH it, or
 * `await`ing it, never settles — the probe hung on that. It is only ever handed out wrapped
 * (`{ cv }`), and "ready" is `cv.Mat` existing (the WASM finished compiling).
 */
async function loadWrapped(): Promise<{ cv: Cv } | null> {
  loading ??= (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cv = require('@techstark/opencv-js') as Cv;
      const started = Date.now();
      while (!(cv as { Mat?: unknown }).Mat) {
        if (Date.now() - started > LOAD_TIMEOUT_MS) {
          throw new Error('timed out');
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return { cv };
    } catch (err) {
      logger.warn(
        `OpenCV not available — cheques are not found by code: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  })();
  return loading;
}

/** True once OpenCV loaded (it loads on first use). */
export async function cvAvailable(): Promise<boolean> {
  return (await loadWrapped()) !== null;
}

/** What OpenCV found in one image: the cheques as pixel boxes, in reading order. */
export interface ChequeScan {
  width: number;
  height: number;
  rects: PxRect[];
}

/**
 * The cheque rectangles of an image (PNG / JPEG / WebP …), top to bottom, left to right —
 * fronts and backs alike (OCR tells them apart). Null when the image cannot be opened or
 * OpenCV is not available.
 */
export async function scanCheques(
  file: Buffer,
  mimeType: string,
): Promise<ChequeScan | null> {
  const loaded = await loadWrapped();
  if (!loaded) return null;
  const { cv } = loaded;
  try {
    const gray = await grayImage(file, mimeType);
    if (!gray) return null;
    const { width, height } = gray;
    // A white border around it: a frame cut flush with the image's edge (a statement's
    // cheque image) is otherwise an open outline, never a rectangle.
    const W = width + 2 * PAD;
    const H = height + 2 * PAD;
    const padded = new Uint8Array(W * H).fill(255);
    for (let y = 0; y < height; y++) {
      padded.set(
        gray.pixels.subarray(y * width, (y + 1) * width),
        (y + PAD) * W + PAD,
      );
    }
    const src = new cv.Mat(H, W, cv.CV_8UC1);
    try {
      src.data.set(padded);
      // 1. Printed frames (a statement's cheque images): rectangular outlines.
      let rects = chequeRects(framedRects(cv, src), W, H);
      // 2. A photo or a scan with no frames: the edges of each cheque's paper.
      if (rects.length < 2) {
        const paper = chequeRects(paperRects(cv, src), W, H);
        if (paper.length > rects.length) rects = paper;
      }
      const unpad = (r: PxRect): PxRect => {
        const x = Math.max(0, r.x - PAD);
        const y = Math.max(0, r.y - PAD);
        return {
          x,
          y,
          w: Math.min(width, r.x - PAD + r.w) - x,
          h: Math.min(height, r.y - PAD + r.h) - y,
        };
      };
      return { width, height, rects: inReadingOrder(rects.map(unpad)) };
    } finally {
      src.delete();
    }
  } catch (err) {
    logger.warn(
      `cheque scan failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Closed rectangular outlines: adaptive threshold → every contour that fills its box. */
function framedRects(cv: Cv, src: Mat): PxRect[] {
  const bin = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.adaptiveThreshold(
      src,
      bin,
      255,
      cv.ADAPTIVE_THRESH_MEAN_C,
      cv.THRESH_BINARY_INV,
      25,
      10,
    );
    cv.findContours(
      bin,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );
    return rectsOf(cv, contours, 0.85, true);
  } finally {
    bin.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/** Paper against a background: edges, thickened, then the outer shapes that fill their box. */
function paperRects(cv: Cv, src: Mat): PxRect[] {
  const edges = new cv.Mat();
  const thick = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.Canny(src, edges, 50, 150);
    cv.dilate(edges, thick, kernel);
    cv.findContours(
      thick,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    );
    return rectsOf(cv, contours, 0.75);
  } finally {
    edges.delete();
    thick.delete();
    kernel.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/**
 * The bounding boxes of the contours that fill at least `fill` of them (a rectangle). With
 * `openFrames`, a frame missing one side (a statement's cheque image cut just above its
 * bottom line — a U, enclosing nothing) counts too: its convex hull fills the box and its
 * outline runs along at least three sides.
 */
function rectsOf(
  cv: Cv,
  contours: MatVector,
  fill: number,
  openFrames = false,
): PxRect[] {
  const out: PxRect[] = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    try {
      const r = cv.boundingRect(c);
      if (r.width < 20 || r.height < 10) continue;
      const box = r.width * r.height;
      let ok = cv.contourArea(c) >= box * fill;
      if (!ok && openFrames) {
        const hull = new cv.Mat();
        try {
          cv.convexHull(c, hull, false, true);
          ok =
            cv.contourArea(hull) >= box * fill &&
            cv.arcLength(c, false) >= 1.5 * (r.width + r.height);
        } finally {
          hull.delete();
        }
      }
      if (ok) out.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    } finally {
      c.delete();
    }
  }
  return out;
}

/** The image as 8-bit gray, at most `ANALYSE_WIDTH` wide (mupdf decodes it). */
async function grayImage(
  file: Buffer,
  mimeType: string,
): Promise<{ width: number; height: number; pixels: Uint8Array } | null> {
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(file, mimeType);
  try {
    const page = doc.loadPage(0);
    try {
      const [x0, , x1] = page.getBounds();
      // Points → the image's own pixels, then down to the analysis width.
      let native = 1;
      try {
        const image = new mupdf.Image(file);
        native = image.getWidth() / Math.max(1, x1 - x0);
        image.destroy();
      } catch {
        // Unknown resolution: one pixel per point.
      }
      const scale = Math.min(native, ANALYSE_WIDTH / Math.max(1, x1 - x0));
      const pix = page.toPixmap(
        [scale, 0, 0, scale, 0, 0],
        mupdf.ColorSpace.DeviceGray,
        false,
      );
      try {
        const width = pix.getWidth();
        const height = pix.getHeight();
        const stride = pix.getStride();
        const src = pix.getPixels();
        const pixels = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
          pixels.set(src.subarray(y * stride, y * stride + width), y * width);
        }
        return { width, height, pixels };
      } finally {
        pix.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}
