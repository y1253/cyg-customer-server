"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cropImage = cropImage;
const crop_util_1 = require("./crop.util");
const pdf_images_1 = require("./pdf-images");
const MAX_WIDTH_PX = 2400;
async function cropImage(file, mimeType, boxes) {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(file, mimeType);
    try {
        const page = doc.loadPage(0);
        try {
            const [x0, y0, x1, y1] = page.getBounds();
            const width = x1 - x0;
            const height = y1 - y0;
            let native = 1;
            try {
                const image = new mupdf.Image(file);
                native = image.getWidth() / width;
                image.destroy();
            }
            catch {
            }
            return boxes.map((box) => {
                const b = (0, crop_util_1.toPageBox)(box, width, height);
                const shifted = [
                    b[0] + x0,
                    b[1] + y0,
                    b[2] + x0,
                    b[3] + y0,
                ];
                const scale = Math.min(Math.max(native, 1), MAX_WIDTH_PX / Math.max(1, b[2] - b[0]));
                return (0, pdf_images_1.renderClip)(mupdf, page, shifted, scale);
            });
        }
        finally {
            page.destroy();
        }
    }
    finally {
        doc.destroy();
    }
}
//# sourceMappingURL=crop.js.map