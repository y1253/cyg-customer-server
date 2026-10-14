/**
 * Cuts the cheque / deposit-slip images out of a statement's image pages (the pages the
 * reader flagged `hasItemImages`), so each can become an attachment on its own row.
 *
 * mupdf lists the images placed on a page (structured text with `preserve-images`); each
 * one big enough to be a cheque is rendered from the PAGE, clipped to its box — so a
 * rotated or masked scan comes out as it is printed, not as it is stored. A page of rows
 * with no such image yields nothing, while a page of only images that has none (a
 * flattened scan) is rendered whole, as one image.
 *
 * ⚠️ mupdf is ESM + WASM, loaded with a real dynamic `import()` — see `pdf-decrypt.ts`.
 */

/** [x0, y0, x1, y1] in PDF points, y down — mupdf's `Rect`. */
export type Box = [number, number, number, number];

export interface ImagePage {
  /** 0-based PDF page. */
  page: number;
  /** The reader listed transactions on it — then never fall back to the whole page. */
  hasRows: boolean;
}

export interface ItemImage {
  page: number;
  /** Its order on the page, top to bottom (0-based). */
  index: number;
  png: Buffer;
}

/** 2 = 144 dpi: a cheque's handwriting and MICR line stay legible. */
const SCALE = 2;
/** Smaller than this is a logo, an icon or a signature, not a cheque. */
const MIN_WIDTH_SHARE = 0.25;
const MIN_HEIGHT_PT = 40;

const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);

/**
 * The image boxes worth attaching, top to bottom then left to right: clipped to the page,
 * at least a quarter of its width, and not (mostly) inside a bigger kept box — an image
 * and its mask, or a scan with a stamp over it, are one item.
 */
export function itemBoxes(boxes: readonly Box[], page: Box): Box[] {
  const minWidth = (page[2] - page[0]) * MIN_WIDTH_SHARE;
  const clipped = boxes
    .map(
      (b): Box => [
        Math.max(b[0], page[0]),
        Math.max(b[1], page[1]),
        Math.min(b[2], page[2]),
        Math.min(b[3], page[3]),
      ],
    )
    .filter((b) => b[2] - b[0] >= minWidth && b[3] - b[1] >= MIN_HEIGHT_PT)
    .sort((a, b) => area(b) - area(a));
  const kept: Box[] = [];
  for (const b of clipped) {
    const inside = kept.some((k) => {
      const overlap: Box = [
        Math.max(b[0], k[0]),
        Math.max(b[1], k[1]),
        Math.min(b[2], k[2]),
        Math.min(b[3], k[3]),
      ];
      return area(overlap) >= area(b) * 0.8;
    });
    if (!inside) kept.push(b);
  }
  return kept.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** The item images on these pages. Never throws for one bad page — it is skipped. */
export async function itemImages(
  pdf: Buffer,
  pages: readonly ImagePage[],
): Promise<ItemImage[]> {
  if (!pages.length) return [];
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
  const out: ItemImage[] = [];
  try {
    if (doc.needsPassword()) return [];
    const count = doc.countPages();
    for (const { page, hasRows } of pages) {
      if (page < 0 || page >= count) continue;
      const p = doc.loadPage(page);
      try {
        const bounds = p.getBounds() as Box;
        const found: Box[] = [];
        const text = p.toStructuredText('preserve-images');
        try {
          text.walk({ onImageBlock: (bbox) => found.push([...bbox] as Box) });
        } finally {
          text.destroy();
        }
        let boxes = itemBoxes(found, bounds);
        if (!boxes.length && !hasRows) boxes = [bounds];
        boxes.forEach((box, index) => {
          // The pixmap starts at 0,0 (mupdf's draw device ignores its origin), so the
          // page is shifted onto it: scale, then move the box's corner to the origin.
          const matrix: [number, number, number, number, number, number] = [
            SCALE,
            0,
            0,
            SCALE,
            -box[0] * SCALE,
            -box[1] * SCALE,
          ];
          const pix = new mupdf.Pixmap(
            mupdf.ColorSpace.DeviceRGB,
            [
              0,
              0,
              Math.round((box[2] - box[0]) * SCALE),
              Math.round((box[3] - box[1]) * SCALE),
            ],
            false,
          );
          try {
            pix.clear(255);
            const device = new mupdf.DrawDevice(matrix, pix);
            try {
              p.run(device, matrix);
              device.close();
            } finally {
              device.destroy();
            }
            out.push({ page, index, png: Buffer.from(pix.asPNG()) });
          } finally {
            pix.destroy();
          }
        });
      } catch {
        // One unreadable page never costs the others their images.
      } finally {
        p.destroy();
      }
    }
    return out;
  } finally {
    doc.destroy();
  }
}
