"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.itemBoxes = itemBoxes;
exports.itemImages = itemImages;
const SCALE = 2;
const MIN_WIDTH_SHARE = 0.25;
const MIN_HEIGHT_PT = 40;
const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
function itemBoxes(boxes, page) {
    const minWidth = (page[2] - page[0]) * MIN_WIDTH_SHARE;
    const clipped = boxes
        .map((b) => [
        Math.max(b[0], page[0]),
        Math.max(b[1], page[1]),
        Math.min(b[2], page[2]),
        Math.min(b[3], page[3]),
    ])
        .filter((b) => b[2] - b[0] >= minWidth && b[3] - b[1] >= MIN_HEIGHT_PT)
        .sort((a, b) => area(b) - area(a));
    const kept = [];
    for (const b of clipped) {
        const inside = kept.some((k) => {
            const overlap = [
                Math.max(b[0], k[0]),
                Math.max(b[1], k[1]),
                Math.min(b[2], k[2]),
                Math.min(b[3], k[3]),
            ];
            return area(overlap) >= area(b) * 0.8;
        });
        if (!inside)
            kept.push(b);
    }
    return kept.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
async function itemImages(pdf, pages) {
    if (!pages.length)
        return [];
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
    const out = [];
    try {
        if (doc.needsPassword())
            return [];
        const count = doc.countPages();
        for (const { page, hasRows } of pages) {
            if (page < 0 || page >= count)
                continue;
            const p = doc.loadPage(page);
            try {
                const bounds = p.getBounds();
                const found = [];
                const text = p.toStructuredText('preserve-images');
                try {
                    text.walk({ onImageBlock: (bbox) => found.push([...bbox]) });
                }
                finally {
                    text.destroy();
                }
                let boxes = itemBoxes(found, bounds);
                if (!boxes.length && !hasRows)
                    boxes = [bounds];
                boxes.forEach((box, index) => {
                    const matrix = [
                        SCALE,
                        0,
                        0,
                        SCALE,
                        -box[0] * SCALE,
                        -box[1] * SCALE,
                    ];
                    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [
                        0,
                        0,
                        Math.round((box[2] - box[0]) * SCALE),
                        Math.round((box[3] - box[1]) * SCALE),
                    ], false);
                    try {
                        pix.clear(255);
                        const device = new mupdf.DrawDevice(matrix, pix);
                        try {
                            p.run(device, matrix);
                            device.close();
                        }
                        finally {
                            device.destroy();
                        }
                        out.push({ page, index, png: Buffer.from(pix.asPNG()) });
                    }
                    finally {
                        pix.destroy();
                    }
                });
            }
            catch {
            }
            finally {
                p.destroy();
            }
        }
        return out;
    }
    finally {
        doc.destroy();
    }
}
//# sourceMappingURL=pdf-images.js.map