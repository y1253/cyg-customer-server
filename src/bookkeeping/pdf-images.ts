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
  /**
   * step2 (2026-11-12): the bank's caption printed over the item ("CHEQUE # 00021 $2,318.08"),
   * read off the PDF's text layer — null when none is printed.
   */
  caption: Caption | null;
  /** The item is one cheque's front AND its back, side by side (TD prints them so). */
  withBack: boolean;
}

/** What a bank prints over a cheque image: its number and, over the front, its amount. */
export interface Caption {
  text: string;
  number: string | null;
  amount: number | null;
}

/** At least 144 dpi; a cheque image stored sharper is rendered at its own resolution. */
const MIN_SCALE = 2;
/** …but never more pixels across than this for one item (front + back included). */
const MAX_WIDTH_PX = 2400;
/** Smaller than this is a logo, an icon or a signature, not a cheque. */
const MIN_WIDTH_SHARE = 0.25;
const MIN_HEIGHT_PT = 40;
/**
 * step2 (2026-11-12): an image covering this share of the page is the page's BACKGROUND (TD
 * and BMO draw every page on one), not an item. TD also places each cheque front and back
 * as its own sharp image (≈ 1700 px) ON that background; keeping the background, every one
 * of them was dropped as "inside a bigger box", and the whole page went to the reader at
 * 144 dpi — four cheques in one picture.
 */
const BACKGROUND_SHARE = 0.85;
/** How far above an item its caption may sit (TD: ≈ 10 pt). */
const CAPTION_GAP_PT = 24;

const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const height = (b: Box) => b[3] - b[1];

/**
 * The image boxes worth attaching, top to bottom then left to right: clipped to the page,
 * at least a quarter of its width, and not (mostly) inside a bigger kept box — an image
 * and its mask, or a scan with a stamp over it, are one item. A page-sized background counts
 * only when nothing else is placed on the page (a flattened scan of cheques).
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
  const placed = clipped.filter((b) => area(b) < area(page) * BACKGROUND_SHARE);
  const kept: Box[] = [];
  for (const b of placed.length ? placed : clipped) {
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
  return readingOrder(kept);
}

/**
 * Top to bottom, then left to right within a ROW: boxes whose tops differ by less than half
 * the row's height are side by side (a cheque's front at y 137.4 and its back at 137.1 —
 * sorting by y alone put the back first). Pure.
 */
export function readingOrder(boxes: readonly Box[]): Box[] {
  const byTop = [...boxes].sort((a, b) => a[1] - b[1]);
  const rows: Box[][] = [];
  for (const b of byTop) {
    const row = rows[rows.length - 1];
    if (row && b[1] < row[0][1] + height(row[0]) / 2) row.push(b);
    else rows.push([b]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a[0] - b[0]));
}

/** True for a box that is only the page's background (see `BACKGROUND_SHARE`). */
export function isBackground(box: Box, page: Box): boolean {
  return area(box) >= area(page) * BACKGROUND_SHARE;
}

/** One line of the page's text layer. */
export interface TextLine {
  box: Box;
  text: string;
}

const CAPTION_NUMBER =
  /(?<![\p{L}\p{N}])(?:cheque|check|chq|ch[eè]que|item)\s*(?:no\.?|n[oº°]|#)?\s*:?\s*(\d{2,10})(?!\d)/iu;
const CAPTION_AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})(?!\d)/;

/** "CHEQUE # 00021 $2,318.08" → number + amount. Pure. */
export function parseCaption(text: string): Caption {
  const n = CAPTION_NUMBER.exec(text);
  const a = CAPTION_AMOUNT.exec(text);
  return {
    text: text.trim().slice(0, 200),
    number: n ? n[1] : null,
    amount: a ? Number(`${a[1].replace(/,/g, '')}.${a[2]}`) : null,
  };
}

/** The text printed just above a box and across it — the bank's caption — or null. Pure. */
export function captionOver(
  box: Box,
  lines: readonly TextLine[],
): TextLine | null {
  const over = lines.filter(
    (l) =>
      l.box[3] <= box[1] + 4 &&
      l.box[3] >= box[1] - CAPTION_GAP_PT &&
      Math.min(l.box[2], box[2]) - Math.max(l.box[0], box[0]) > 0 &&
      l.text.trim(),
  );
  if (!over.length) return null;
  // One caption line can be split in two by the layout ("CHEQUE # 00021" … "$2,318.08").
  const lowest = Math.max(...over.map((l) => l.box[3]));
  const row = over
    .filter((l) => l.box[3] >= lowest - 4)
    .sort((a, b) => a.box[0] - b.box[0]);
  return {
    box: [
      Math.min(...row.map((l) => l.box[0])),
      Math.min(...row.map((l) => l.box[1])),
      Math.max(...row.map((l) => l.box[2])),
      lowest,
    ],
    text: row.map((l) => l.text.trim()).join(' '),
  };
}

/** One item to attach: the box to render (caption included) and what was printed over it. */
export interface PlacedItem {
  box: Box;
  caption: Caption | null;
  withBack: boolean;
}

const union = (a: Box, b: Box): Box => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];

/**
 * step2 (2026-11-12): the items of a page. TD prints each cheque as its FRONT and its BACK
 * side by side, both captioned "CHEQUE # 00021" (the amount only over the front): those two
 * are ONE item — a back read alone became a "cheque" with no amount, left unmatched. Each
 * item's box takes its caption in, so the bank's printed number and amount stay on the
 * image. Pure.
 */
export function placeItems(
  boxes: readonly Box[],
  lines: readonly TextLine[],
): PlacedItem[] {
  const captions = boxes.map((b) => captionOver(b, lines));
  const parsed = captions.map((c) => (c ? parseCaption(c.text) : null));
  const out: PlacedItem[] = [];
  const withCaption = (k: number): Box =>
    captions[k] ? union(boxes[k], captions[k].box) : boxes[k];
  for (let i = 0; i < boxes.length; i++) {
    const caption = parsed[i];
    const j = i + 1;
    const sameRow =
      j < boxes.length &&
      Math.min(boxes[i][3], boxes[j][3]) - Math.max(boxes[i][1], boxes[j][1]) >=
        0.6 * Math.min(height(boxes[i]), height(boxes[j]));
    const back =
      sameRow &&
      !!caption?.number &&
      parsed[j]?.number === caption.number &&
      parsed[j]?.amount === null;
    out.push({
      box: back ? union(withCaption(i), withCaption(j)) : withCaption(i),
      caption,
      withBack: back,
    });
    if (back) i = j;
  }
  return out;
}

const grow = (b: Box, by: number, page: Box): Box => [
  Math.max(page[0], b[0] - by),
  Math.max(page[1], b[1] - by),
  Math.min(page[2], b[2] + by),
  Math.min(page[3], b[3] + by),
];

/** The text layer of a page, one entry per line (mupdf's own lines). */
function pageLines(text: {
  walk: (w: {
    beginLine?: (bbox: number[]) => void;
    onChar?: (c: string) => void;
    endLine?: () => void;
  }) => void;
}): TextLine[] {
  const lines: TextLine[] = [];
  let current: TextLine | null = null;
  text.walk({
    beginLine: (bbox) => (current = { box: [...bbox] as Box, text: '' }),
    onChar: (c) => {
      if (current) current.text += c;
    },
    endLine: () => {
      if (current) lines.push(current);
      current = null;
    },
  });
  return lines;
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
        const found: Array<{ box: Box; ppt: number }> = [];
        const text = p.toStructuredText('preserve-images');
        let lines: TextLine[] = [];
        try {
          text.walk({
            onImageBlock: (bbox, _m, image) =>
              found.push({
                box: [...bbox] as Box,
                // The image's own pixels per point on this page.
                ppt: image.getWidth() / Math.max(1, bbox[2] - bbox[0]),
              }),
          });
          lines = pageLines(text);
        } finally {
          text.destroy();
        }
        let boxes = itemBoxes(
          found.map((f) => f.box),
          bounds,
        );
        // A page of rows drawn on a full-page background holds no cheque of its own (BMO
        // draws every page so; it used to come back as "This looks like a bank statement").
        if (boxes.length === 1 && isBackground(boxes[0], bounds) && hasRows) {
          boxes = [];
        }
        if (!boxes.length && !hasRows) boxes = [bounds];
        placeItems(boxes, lines).forEach((placed, index) => {
          // 3 pt more on every side (inside the page): the frame drawn at an image's very
          // edge stays whole, so OpenCV sees a closed rectangle.
          const item = { ...placed, box: grow(placed.box, 3, bounds) };
          const sharpest = Math.max(
            0,
            ...found
              .filter((f) => !isBackground(f.box, bounds))
              .filter((f) => area(union(f.box, item.box)) <= area(item.box) + 1)
              .map((f) => f.ppt),
          );
          const scale = Math.min(
            Math.max(MIN_SCALE, sharpest),
            MAX_WIDTH_PX / Math.max(1, item.box[2] - item.box[0]),
          );
          out.push({
            page,
            index,
            png: renderClip(mupdf, p, item.box, scale),
            caption: item.caption,
            withBack: item.withBack,
          });
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

type Mupdf = typeof import('mupdf');
type MupdfPage = ReturnType<InstanceType<Mupdf['Document']>['loadPage']>;

/**
 * One box of a page as a PNG, at `scale` pixels per point. The pixmap starts at 0,0
 * (mupdf's draw device ignores its origin), so the page is shifted onto it: scale, then move
 * the box's corner to the origin. step9: also cuts each cheque out of an image (`crop.ts`).
 *
 * ⚠️ step2 (2026-11-08): the matrix goes to `run` ONLY — the draw device gets the identity.
 * `fz_new_draw_device(transform, …)` applies its own transform to everything drawn, so
 * passing the matrix to both applied it TWICE: at scale 2 every cheque came out 4× zoomed
 * and shifted — its number and payee cut off, and a slice of the NEXT cheque at its edge
 * (the "two cheques on one transaction" of step2.md). Verified by rendering both ways.
 */
export function renderClip(
  mupdf: Mupdf,
  p: MupdfPage,
  box: Box,
  scale: number,
): Buffer {
  const matrix: [number, number, number, number, number, number] = [
    scale,
    0,
    0,
    scale,
    -box[0] * scale,
    -box[1] * scale,
  ];
  const pix = new mupdf.Pixmap(
    mupdf.ColorSpace.DeviceRGB,
    [
      0,
      0,
      Math.max(1, Math.round((box[2] - box[0]) * scale)),
      Math.max(1, Math.round((box[3] - box[1]) * scale)),
    ],
    false,
  );
  try {
    pix.clear(255);
    const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
    try {
      p.run(device, matrix);
      device.close();
    } finally {
      device.destroy();
    }
    return Buffer.from(pix.asPNG());
  } finally {
    pix.destroy();
  }
}
