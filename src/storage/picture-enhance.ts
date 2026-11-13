/**
 * step2 (2026-11-13, user: "every attachment / pic should go through a script which makes
 * it clear and sharp, not cropped, like the internal system does for facial login"): the
 * pure rules of the picture clean-up pass every stored picture goes through. The sharp
 * calls are in `picture-enhancer.service.ts`.
 *
 * Modelled on the internal app's face pass (`internal/server/src/luxand/face-image.ts`) —
 * EXIF rotate, resize, a CONDITIONAL tone fix, a conditional denoise, a mild sharpen — but
 * retuned for receipts, cheques and documents:
 * - it NEVER crops (the face pass crops to 1.8× the face): the whole picture is kept;
 * - paper is mostly white, so the face pass's "aim the mean at 128" would darken a
 *   receipt — the tone fix is a luminance stretch, and only for a flat or dark picture;
 * - a well-exposed scan gets no tone change at all (the face pass's no-op rule).
 *
 * ⚠️ TWIN: `internal/server/src/storage/picture-enhance.ts` (SMS / WhatsApp / email
 * pictures). Keep the two identical — the same picture must come out the same whichever
 * door it came in by.
 */

export type PictureFormat = 'jpeg' | 'png' | 'webp';

/** Only these are cleaned up. GIF keeps its animation, PDF / audio / HEIC are never touched. */
export function pictureFormatOf(mime: string | null | undefined): PictureFormat | null {
  const m = (mime ?? '').toLowerCase().split(';')[0].trim();
  if (m === 'image/jpeg' || m === 'image/jpg' || m === 'image/pjpeg') return 'jpeg';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  return null;
}

/** A picture's long edge is shrunk to this — more only costs storage and AI tiles. */
export const MAX_LONG_EDGE = 3000;
/** A smaller picture is enlarged towards this, so small print stays readable… */
export const MIN_LONG_EDGE = 1600;
/** …but never more than this: past 2× interpolation invents edges (the face pass's cap). */
export const MAX_UPSCALE = 2;

export interface ResizePlan {
  width: number;
  height: number;
  upscaled: boolean;
}

/**
 * The size to resize to, keeping the WHOLE frame (no crop, aspect kept), or null to keep
 * the size. `width` / `height` are the picture as displayed (EXIF rotation applied).
 */
export function resizePlan(width: number, height: number): ResizePlan | null {
  if (!(width > 0) || !(height > 0)) return null;
  const long = Math.max(width, height);
  let scale = 1;
  if (long > MAX_LONG_EDGE) scale = MAX_LONG_EDGE / long;
  else if (long < MIN_LONG_EDGE) scale = Math.min(MAX_UPSCALE, MIN_LONG_EDGE / long);
  if (scale === 1) return null;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    upscaled: scale > 1,
  };
}

/** Brightness of the picture (0–255 grey), measured on a small greyscale copy. */
export interface Brightness {
  mean: number;
  stdev: number;
}

/** Below this spread a picture is flat (a faded receipt, a grey photo of paper). */
export const FLAT_STDEV = 45;
/** Below this mean it is dark (a receipt photographed under a desk lamp's shadow). */
export const DARK_MEAN = 110;
/** Below this mean it is dark enough that the stretch lifts its grain too. */
export const DENOISE_MEAN = 80;

/**
 * The luminance stretch's percentiles, or null when the picture is already fine — a
 * well-exposed scan is left alone, so the pass never makes a good picture worse.
 */
export function toneFor(b: Brightness | null): { lower: number; upper: number } | null {
  if (!b) return null;
  if (b.stdev >= FLAT_STDEV && b.mean >= DARK_MEAN) return null;
  return { lower: 1, upper: 99 };
}

/** A 3×3 median (edge-preserving, never a blur) — only for a dark picture, before sharpening. */
export const needsDenoise = (b: Brightness | null): boolean => !!b && b.mean < DENOISE_MEAN;

/**
 * A mild unsharp mask. `m1: 0` = no boost in flat areas (paper grain stays as it is),
 * `m2` = the boost on edges (the print). A little stronger after enlarging.
 */
export function sharpenFor(upscaled: boolean): { sigma: number; m1: number; m2: number } {
  return { sigma: upscaled ? 1.0 : 0.8, m1: 0, m2: 2 };
}

/** JPEG quality, and 4:4:4 chroma so thin coloured print keeps its edges. */
export const JPEG_QUALITY = 92;
export const WEBP_QUALITY = 92;
