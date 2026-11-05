import type { DocumentBox } from './attachment-extractor';

/**
 * step9 (2026-11-05): when ONE image holds several documents (two cheques side by side on a
 * statement's cheque page, two cheques in one photo), each is cut into its own file so each
 * transaction shows only its own cheque. The reader gives every document a box (fractions of
 * the image); these pure rules decide whether the boxes can be trusted. Pure, so it is
 * unit-tested; the cutting itself is `crop.ts` (mupdf).
 */

/** Two boxes overlapping more than this share of the smaller one are the same document. */
const MAX_OVERLAP = 0.5;

const area = (b: DocumentBox) =>
  Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

function overlapShare(a: DocumentBox, b: DocumentBox): number {
  const inter = area({
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  });
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 ? inter / smaller : 1;
}

/**
 * The box of each document, in order, when the file should be cut — else null (it stays one
 * file, as before step9). Cut only when there are at least two documents, EVERY one has a
 * box, no two boxes are mostly the same area, and no box is (nearly) the whole image.
 */
export function cropPlan(
  boxes: ReadonlyArray<DocumentBox | null | undefined>,
): DocumentBox[] | null {
  if (boxes.length < 2) return null;
  if (boxes.some((b) => !b)) return null;
  const list = boxes as DocumentBox[];
  if (list.some((b) => area(b) > 0.9)) return null;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (overlapShare(list[i], list[j]) > MAX_OVERLAP) return null;
    }
  }
  return list;
}

/**
 * A box in the image's own units (mupdf page points), grown by a small margin so the edge
 * of a cheque is never cut off, and kept inside the image.
 */
export function toPageBox(
  box: DocumentBox,
  width: number,
  height: number,
  margin = 0.01,
): [number, number, number, number] {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(box.x0 - margin) * width,
    clamp(box.y0 - margin) * height,
    clamp(box.x1 + margin) * width,
    clamp(box.y1 + margin) * height,
  ];
}
