import type { DocumentBox } from '../attachment-extractor';

/**
 * step2 (2026-11-12, user's request: "use OpenCV on images and send what it finds to the
 * model, so it captures two cheques in one image"). The pure half of `cheque-vision.ts`: which
 * of the rectangles OpenCV found are cheques, in what order, and which back belongs to which
 * front. Unit-tested; OpenCV and mupdf themselves are checked with
 * `scripts/bookkeeping-probe.ts --cv`.
 */

/** A rectangle in pixels of the analysed image. */
export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** width / height of a cheque, generously: personal 2.2, business 2.4, a frame with margin. */
export const MIN_ASPECT = 1.5;
export const MAX_ASPECT = 3.8;
/** A cheque is at least this share of the image (a logo, the amount box, a stamp are not). */
export const MIN_AREA_SHARE = 0.025;
/** …and at most this (the whole page / photo is not one of the cheques on it). */
export const MAX_AREA_SHARE = 0.92;
/** Two rectangles this much the same are one frame (a border's outer and inner edge). */
const SAME_FRAME = 0.7;
/** A rectangle at least this much inside another counts as inside it. */
const INSIDE = 0.85;

const areaOf = (r: PxRect) => Math.max(0, r.w) * Math.max(0, r.h);

function overlap(a: PxRect, b: PxRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** True when `inner` lies (almost) wholly inside `outer`. */
const inside = (inner: PxRect, outer: PxRect) =>
  overlap(inner, outer) >= areaOf(inner) * INSIDE;

/** Cheque-shaped and cheque-sized for an image of this size. */
export function chequeShaped(
  r: PxRect,
  width: number,
  height: number,
): boolean {
  if (r.h <= 0) return false;
  const aspect = r.w / r.h;
  const share = areaOf(r) / (width * height);
  return (
    aspect >= MIN_ASPECT &&
    aspect <= MAX_ASPECT &&
    share >= MIN_AREA_SHARE &&
    share <= MAX_AREA_SHARE
  );
}

/**
 * The cheques among OpenCV's rectangles. A frame's outer and inner edge (nearly the same box)
 * are one — the outer is kept. A rectangle holding two or more cheques is the sheet they are
 * on, not a cheque: dropped. A much smaller one inside a cheque (its amount box) is a part of
 * it: dropped. Pure.
 */
export function chequeRects(
  rects: readonly PxRect[],
  width: number,
  height: number,
): PxRect[] {
  const shaped = rects
    .filter((r) => chequeShaped(r, width, height))
    .sort((a, b) => areaOf(b) - areaOf(a));
  // One per frame: the outer edge of a border wins over its inner edge.
  const frames: PxRect[] = [];
  for (const r of shaped) {
    const same = frames.some(
      (f) => inside(r, f) && areaOf(r) >= areaOf(f) * SAME_FRAME,
    );
    if (!same) frames.push(r);
  }
  return frames.filter((f) => {
    const within = frames.filter((g) => g !== f && inside(g, f));
    // A container of two or more cheques is the sheet; one part inside is kept as a part.
    if (within.length >= 2) return false;
    // A part of a bigger cheque (the box it sits in has fewer than two cheques).
    const holders = frames.filter((g) => g !== f && inside(f, g));
    return !holders.some(
      (g) => frames.filter((k) => k !== g && inside(k, g)).length < 2,
    );
  });
}

/**
 * Top to bottom, then left to right within a ROW (tops closer than half a box's height are
 * side by side). Pure.
 */
export function inReadingOrder(rects: readonly PxRect[]): PxRect[] {
  const byTop = [...rects].sort((a, b) => a.y - b.y);
  const rows: PxRect[][] = [];
  for (const r of byTop) {
    const row = rows[rows.length - 1];
    if (row && r.y < row[0].y + row[0].h / 2) row.push(r);
    else rows.push([r]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/** True when two boxes are side by side in one row. */
export function sameRow(a: PxRect, b: PxRect): boolean {
  const shared = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return shared >= 0.6 * Math.min(a.h, b.h);
}

/** One cheque found: its front, and its back when one was found beside it. */
export interface FoundCheque {
  front: PxRect;
  back: PxRect | null;
}

/**
 * Fronts with their backs: a back (as OCR judged it, `isBack[i]`) belongs to the front just
 * before it in the same row (TD prints front | back) and is never a cheque of its own. The
 * FIRST of a row is always a front — OCR calls a faint scan of a front "a back" (too little
 * text), and a bank prints the front first. Pure.
 */
export function pairBacks(
  ordered: readonly PxRect[],
  isBack: readonly boolean[],
): FoundCheque[] {
  const out: FoundCheque[] = [];
  ordered.forEach((r, i) => {
    const last = out[out.length - 1];
    const beside = !!last && sameRow(last.front, r);
    if (isBack[i] && beside && !last.back) last.back = r;
    else out.push({ front: r, back: null });
  });
  return out;
}

/**
 * The box to cut for one cheque, as fractions of the image: its front (and back), grown
 * UPWARD to take in the bank's caption printed over it ("CHEQUE # 00021 $2,318.08") — at most
 * `captionShare` of its height, never into the box above it — and by a small margin. Pure.
 */
export function cutBox(
  cheque: FoundCheque,
  all: readonly PxRect[],
  width: number,
  height: number,
  captionShare = 0.2,
): DocumentBox {
  const parts = cheque.back ? [cheque.front, cheque.back] : [cheque.front];
  let x0 = Math.min(...parts.map((p) => p.x));
  let y0 = Math.min(...parts.map((p) => p.y));
  let x1 = Math.max(...parts.map((p) => p.x + p.w));
  const y1 = Math.max(...parts.map((p) => p.y + p.h));
  const above = all
    .filter((r) => !parts.includes(r))
    .filter((r) => r.y + r.h <= y0 && r.x < x1 && r.x + r.w > x0)
    .map((r) => r.y + r.h);
  const ceiling = above.length ? Math.max(...above) : 0;
  y0 = Math.max(ceiling, y0 - cheque.front.h * captionShare);
  const margin = Math.round(Math.min(width, height) * 0.005);
  x0 = Math.max(0, x0 - margin);
  x1 = Math.min(width, x1 + margin);
  return {
    x0: x0 / width,
    y0: Math.max(0, y0) / height,
    x1: x1 / width,
    y1: Math.min(height, y1 + margin) / height,
  };
}

/**
 * A bank's cheque page is a grid: when EVERY row holds two frames side by side, at least one
 * right-hand frame was read as a back and none of them shows a cheque number, the whole
 * right column is backs (TD: front | back on every row). OCR on a 144 dpi page recognises
 * only some backs one by one; the layout settles the rest. Otherwise `isBack` as given. Pure.
 */
export function backColumn(
  ordered: readonly PxRect[],
  isBack: readonly boolean[],
  hasNumber: readonly boolean[],
): boolean[] {
  const rows: number[][] = [];
  ordered.forEach((r, i) => {
    const row = rows[rows.length - 1];
    if (row && sameRow(ordered[row[0]], r)) row.push(i);
    else rows.push([i]);
  });
  const right = rows.map((row) => row[1]);
  const grid = rows.length > 0 && rows.every((row) => row.length === 2);
  if (
    grid &&
    right.some((i) => isBack[i]) &&
    !right.some((i) => hasNumber[i])
  ) {
    return ordered.map((_, i) => right.includes(i));
  }
  return [...isBack];
}
