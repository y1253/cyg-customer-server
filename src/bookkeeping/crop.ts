import type { DocumentBox } from './attachment-extractor';
import { toPageBox } from './crop.util';
import { renderClip } from './pdf-images';

/** Never more pixels across than this for one crop (a phone photo can be 4000 wide). */
const MAX_WIDTH_PX = 2400;

/**
 * step9: cut each box out of an image (PNG / JPEG / WebP …) into its own PNG, in the order
 * given. mupdf opens an image as a one-page document; each box is rendered clipped at the
 * image's own resolution (capped), like the cheques cut out of a statement page.
 *
 * ⚠️ mupdf is ESM + WASM, loaded with a real dynamic `import()` — see `pdf-decrypt.ts`.
 * Throws when the image cannot be opened; the caller then keeps the file uncut.
 */
export async function cropImage(
  file: Buffer,
  mimeType: string,
  boxes: readonly DocumentBox[],
  /** step2 (2026-11-12): render each crop at least this wide (a small scan, upscaled). */
  minWidthPx = 0,
): Promise<Buffer[]> {
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(file, mimeType);
  try {
    const page = doc.loadPage(0);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      const width = x1 - x0;
      const height = y1 - y0;
      // Points → pixels at the image's own resolution.
      let native = 1;
      try {
        const image = new mupdf.Image(file);
        native = image.getWidth() / width;
        image.destroy();
      } catch {
        // Unknown resolution: render at one pixel per point.
      }
      return boxes.map((box) => {
        const b = toPageBox(box, width, height);
        const shifted: [number, number, number, number] = [
          b[0] + x0,
          b[1] + y0,
          b[2] + x0,
          b[3] + y0,
        ];
        const scale = Math.min(
          Math.max(native, 1, minWidthPx / Math.max(1, b[2] - b[0])),
          MAX_WIDTH_PX / Math.max(1, b[2] - b[0]),
        );
        return renderClip(mupdf, page, shifted, scale);
      });
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}
