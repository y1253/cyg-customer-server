"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.itemBoxes = itemBoxes;
exports.readingOrder = readingOrder;
exports.isBackground = isBackground;
exports.parseCaption = parseCaption;
exports.captionOver = captionOver;
exports.placeItems = placeItems;
exports.itemImages = itemImages;
exports.renderClip = renderClip;
const MIN_SCALE = 2;
const MAX_WIDTH_PX = 2400;
const MIN_WIDTH_SHARE = 0.25;
const MIN_HEIGHT_PT = 40;
const BACKGROUND_SHARE = 0.85;
const CAPTION_GAP_PT = 24;
const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const height = (b) => b[3] - b[1];
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
    const placed = clipped.filter((b) => area(b) < area(page) * BACKGROUND_SHARE);
    const kept = [];
    for (const b of placed.length ? placed : clipped) {
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
    return readingOrder(kept);
}
function readingOrder(boxes) {
    const byTop = [...boxes].sort((a, b) => a[1] - b[1]);
    const rows = [];
    for (const b of byTop) {
        const row = rows[rows.length - 1];
        if (row && b[1] < row[0][1] + height(row[0]) / 2)
            row.push(b);
        else
            rows.push([b]);
    }
    return rows.flatMap((r) => r.sort((a, b) => a[0] - b[0]));
}
function isBackground(box, page) {
    return area(box) >= area(page) * BACKGROUND_SHARE;
}
const CAPTION_NUMBER = /(?<![\p{L}\p{N}])(?:cheque|check|chq|ch[eè]que|item)\s*(?:no\.?|n[oº°]|#)?\s*:?\s*(\d{2,10})(?!\d)/iu;
const CAPTION_AMOUNT = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})(?!\d)/;
function parseCaption(text) {
    const n = CAPTION_NUMBER.exec(text);
    const a = CAPTION_AMOUNT.exec(text);
    return {
        text: text.trim().slice(0, 200),
        number: n ? n[1] : null,
        amount: a ? Number(`${a[1].replace(/,/g, '')}.${a[2]}`) : null,
    };
}
function captionOver(box, lines) {
    const over = lines.filter((l) => l.box[3] <= box[1] + 4 &&
        l.box[3] >= box[1] - CAPTION_GAP_PT &&
        Math.min(l.box[2], box[2]) - Math.max(l.box[0], box[0]) > 0 &&
        l.text.trim());
    if (!over.length)
        return null;
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
const union = (a, b) => [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
];
function placeItems(boxes, lines) {
    const captions = boxes.map((b) => captionOver(b, lines));
    const parsed = captions.map((c) => (c ? parseCaption(c.text) : null));
    const out = [];
    const withCaption = (k) => captions[k] ? union(boxes[k], captions[k].box) : boxes[k];
    for (let i = 0; i < boxes.length; i++) {
        const caption = parsed[i];
        const j = i + 1;
        const sameRow = j < boxes.length &&
            Math.min(boxes[i][3], boxes[j][3]) - Math.max(boxes[i][1], boxes[j][1]) >=
                0.6 * Math.min(height(boxes[i]), height(boxes[j]));
        const back = sameRow &&
            !!caption?.number &&
            parsed[j]?.number === caption.number &&
            parsed[j]?.amount === null;
        out.push({
            box: back ? union(withCaption(i), withCaption(j)) : withCaption(i),
            caption,
            withBack: back,
        });
        if (back)
            i = j;
    }
    return out;
}
const grow = (b, by, page) => [
    Math.max(page[0], b[0] - by),
    Math.max(page[1], b[1] - by),
    Math.min(page[2], b[2] + by),
    Math.min(page[3], b[3] + by),
];
function pageLines(text) {
    const lines = [];
    let current = null;
    text.walk({
        beginLine: (bbox) => (current = { box: [...bbox], text: '' }),
        onChar: (c) => {
            if (current)
                current.text += c;
        },
        endLine: () => {
            if (current)
                lines.push(current);
            current = null;
        },
    });
    return lines;
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
                let lines = [];
                try {
                    text.walk({
                        onImageBlock: (bbox, _m, image) => found.push({
                            box: [...bbox],
                            ppt: image.getWidth() / Math.max(1, bbox[2] - bbox[0]),
                        }),
                    });
                    lines = pageLines(text);
                }
                finally {
                    text.destroy();
                }
                let boxes = itemBoxes(found.map((f) => f.box), bounds);
                if (boxes.length === 1 && isBackground(boxes[0], bounds) && hasRows) {
                    boxes = [];
                }
                if (!boxes.length && !hasRows)
                    boxes = [bounds];
                placeItems(boxes, lines).forEach((placed, index) => {
                    const item = { ...placed, box: grow(placed.box, 3, bounds) };
                    const sharpest = Math.max(0, ...found
                        .filter((f) => !isBackground(f.box, bounds))
                        .filter((f) => area(union(f.box, item.box)) <= area(item.box) + 1)
                        .map((f) => f.ppt));
                    const scale = Math.min(Math.max(MIN_SCALE, sharpest), MAX_WIDTH_PX / Math.max(1, item.box[2] - item.box[0]));
                    out.push({
                        page,
                        index,
                        png: renderClip(mupdf, p, item.box, scale),
                        caption: item.caption,
                        withBack: item.withBack,
                    });
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
function renderClip(mupdf, p, box, scale) {
    const matrix = [
        scale,
        0,
        0,
        scale,
        -box[0] * scale,
        -box[1] * scale,
    ];
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [
        0,
        0,
        Math.max(1, Math.round((box[2] - box[0]) * scale)),
        Math.max(1, Math.round((box[3] - box[1]) * scale)),
    ], false);
    try {
        pix.clear(255);
        const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
        try {
            p.run(device, matrix);
            device.close();
        }
        finally {
            device.destroy();
        }
        return Buffer.from(pix.asPNG());
    }
    finally {
        pix.destroy();
    }
}
//# sourceMappingURL=pdf-images.js.map