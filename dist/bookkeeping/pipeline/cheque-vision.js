"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cvAvailable = cvAvailable;
exports.scanCheques = scanCheques;
const common_1 = require("@nestjs/common");
const cheque_vision_util_1 = require("./cheque-vision.util");
const ANALYSE_WIDTH = 1600;
const LOAD_TIMEOUT_MS = 30_000;
const PAD = 8;
const logger = new common_1.Logger('ChequeVision');
let loading = null;
async function loadWrapped() {
    loading ??= (async () => {
        try {
            const cv = require('@techstark/opencv-js');
            const started = Date.now();
            while (!cv.Mat) {
                if (Date.now() - started > LOAD_TIMEOUT_MS) {
                    throw new Error('timed out');
                }
                await new Promise((r) => setTimeout(r, 50));
            }
            return { cv };
        }
        catch (err) {
            logger.warn(`OpenCV not available — cheques are not found by code: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    })();
    return loading;
}
async function cvAvailable() {
    return (await loadWrapped()) !== null;
}
async function scanCheques(file, mimeType) {
    const loaded = await loadWrapped();
    if (!loaded)
        return null;
    const { cv } = loaded;
    try {
        const gray = await grayImage(file, mimeType);
        if (!gray)
            return null;
        const { width, height } = gray;
        const W = width + 2 * PAD;
        const H = height + 2 * PAD;
        const padded = new Uint8Array(W * H).fill(255);
        for (let y = 0; y < height; y++) {
            padded.set(gray.pixels.subarray(y * width, (y + 1) * width), (y + PAD) * W + PAD);
        }
        const src = new cv.Mat(H, W, cv.CV_8UC1);
        try {
            src.data.set(padded);
            let rects = (0, cheque_vision_util_1.chequeRects)(framedRects(cv, src), W, H);
            if (rects.length < 2) {
                const paper = (0, cheque_vision_util_1.chequeRects)(paperRects(cv, src), W, H);
                if (paper.length > rects.length)
                    rects = paper;
            }
            const unpad = (r) => {
                const x = Math.max(0, r.x - PAD);
                const y = Math.max(0, r.y - PAD);
                return {
                    x,
                    y,
                    w: Math.min(width, r.x - PAD + r.w) - x,
                    h: Math.min(height, r.y - PAD + r.h) - y,
                };
            };
            return { width, height, rects: (0, cheque_vision_util_1.inReadingOrder)(rects.map(unpad)) };
        }
        finally {
            src.delete();
        }
    }
    catch (err) {
        logger.warn(`cheque scan failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
function framedRects(cv, src) {
    const bin = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    try {
        cv.adaptiveThreshold(src, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 25, 10);
        cv.findContours(bin, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        return rectsOf(cv, contours, 0.85, true);
    }
    finally {
        bin.delete();
        contours.delete();
        hierarchy.delete();
    }
}
function paperRects(cv, src) {
    const edges = new cv.Mat();
    const thick = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    try {
        cv.Canny(src, edges, 50, 150);
        cv.dilate(edges, thick, kernel);
        cv.findContours(thick, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        return rectsOf(cv, contours, 0.75);
    }
    finally {
        edges.delete();
        thick.delete();
        kernel.delete();
        contours.delete();
        hierarchy.delete();
    }
}
function rectsOf(cv, contours, fill, openFrames = false) {
    const out = [];
    for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        try {
            const r = cv.boundingRect(c);
            if (r.width < 20 || r.height < 10)
                continue;
            const box = r.width * r.height;
            let ok = cv.contourArea(c) >= box * fill;
            if (!ok && openFrames) {
                const hull = new cv.Mat();
                try {
                    cv.convexHull(c, hull, false, true);
                    ok =
                        cv.contourArea(hull) >= box * fill &&
                            cv.arcLength(c, false) >= 1.5 * (r.width + r.height);
                }
                finally {
                    hull.delete();
                }
            }
            if (ok)
                out.push({ x: r.x, y: r.y, w: r.width, h: r.height });
        }
        finally {
            c.delete();
        }
    }
    return out;
}
async function grayImage(file, mimeType) {
    const mupdf = await import('mupdf');
    const doc = mupdf.Document.openDocument(file, mimeType);
    try {
        const page = doc.loadPage(0);
        try {
            const [x0, , x1] = page.getBounds();
            let native = 1;
            try {
                const image = new mupdf.Image(file);
                native = image.getWidth() / Math.max(1, x1 - x0);
                image.destroy();
            }
            catch {
            }
            const scale = Math.min(native, ANALYSE_WIDTH / Math.max(1, x1 - x0));
            const pix = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceGray, false);
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
            }
            finally {
                pix.destroy();
            }
        }
        finally {
            page.destroy();
        }
    }
    finally {
        doc.destroy();
    }
}
//# sourceMappingURL=cheque-vision.js.map