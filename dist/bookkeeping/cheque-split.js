"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitRegions = splitRegions;
exports.pageWhite = pageWhite;
exports.chequeRegions = chequeRegions;
const MIN_ASPECT = 1.5;
const MAX_ASPECT = 3.8;
const MIN_AREA_SHARE = 0.04;
const MIN_GAP_PX = 4;
const BLANK_SHARE = 0.004;
const MAX_GAPS = 8;
const MAX_DEPTH = 6;
const MAX_STEPS = 600;
const MIN_FILL = 0.5;
const w = (b) => b.x1 - b.x0;
const h = (b) => b.y1 - b.y0;
function splitRegions(ink, width, height) {
    const imageArea = width * height;
    const at = (x, y) => ink[y * width + x];
    const W = width + 1;
    const sat = new Uint32Array(W * (height + 1));
    for (let y = 0; y < height; y++) {
        let row = 0;
        for (let x = 0; x < width; x++) {
            row += ink[y * width + x];
            sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row;
        }
    }
    const inkIn = (b) => sat[b.y1 * W + b.x1] -
        sat[b.y0 * W + b.x1] -
        sat[b.y1 * W + b.x0] +
        sat[b.y0 * W + b.x0];
    const rowInk = (b, y) => {
        let n = 0;
        for (let x = b.x0; x < b.x1; x++)
            n += at(x, y);
        return n;
    };
    const colInk = (b, x) => {
        let n = 0;
        for (let y = b.y0; y < b.y1; y++)
            n += at(x, y);
        return n;
    };
    const trim = (b) => {
        const rowBlank = (y) => rowInk(b, y) <= w(b) * BLANK_SHARE;
        const colBlank = (x) => colInk(b, x) <= h(b) * BLANK_SHARE;
        let { x0, y0, x1, y1 } = b;
        while (y0 < y1 && rowBlank(y0))
            y0++;
        while (y1 > y0 && rowBlank(y1 - 1))
            y1--;
        const t = { x0, y0, x1, y1 };
        while (t.x0 < t.x1 && colBlank(t.x0))
            t.x0++;
        while (t.x1 > t.x0 && colBlank(t.x1 - 1))
            t.x1--;
        ({ x0, x1 } = t);
        return x1 - x0 > 0 && y1 - y0 > 0 ? { x0, y0, x1, y1 } : null;
    };
    const chequeShaped = (b) => {
        const aspect = w(b) / h(b);
        return (aspect >= MIN_ASPECT &&
            aspect <= MAX_ASPECT &&
            w(b) * h(b) >= imageArea * MIN_AREA_SHARE &&
            inkIn(b) >= w(b) * h(b) * MIN_FILL);
    };
    const gaps = (b, axis) => {
        const from = axis === 'y' ? b.y0 : b.x0;
        const to = axis === 'y' ? b.y1 : b.x1;
        const span = axis === 'y' ? w(b) : h(b);
        const minGap = Math.max(MIN_GAP_PX, Math.round((to - from) * 0.01));
        const out = [];
        let start = -1;
        for (let i = from; i < to; i++) {
            const blank = (axis === 'y' ? rowInk(b, i) : colInk(b, i)) <= span * BLANK_SHARE;
            if (blank && start < 0)
                start = i;
            if (!blank && start >= 0) {
                if (i - start >= minGap && start > from)
                    out.push([start, i]);
                start = -1;
            }
        }
        return out.sort((a, c) => c[1] - c[0] - (a[1] - a[0])).slice(0, MAX_GAPS);
    };
    let steps = 0;
    const solve = (block, depth) => {
        if (++steps > MAX_STEPS)
            return null;
        const b = trim(block);
        if (!b)
            return null;
        if (depth < MAX_DEPTH) {
            for (const axis of ['y', 'x']) {
                for (const [g0, g1] of gaps(b, axis)) {
                    const first = axis === 'y' ? { ...b, y1: g0 } : { ...b, x1: g0 };
                    const second = axis === 'y' ? { ...b, y0: g1 } : { ...b, x0: g1 };
                    const a = solve(first, depth + 1);
                    if (!a)
                        continue;
                    const c = solve(second, depth + 1);
                    if (!c)
                        continue;
                    return [...a, ...c];
                }
            }
        }
        return chequeShaped(b) ? [b] : null;
    };
    const found = collect({ x0: 0, y0: 0, x1: width, y1: height }, solve, trim, gaps);
    return found.length >= 2 && steps <= MAX_STEPS
        ? found.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
        : [];
}
function collect(block, solve, trim, gaps, depth = 0) {
    const whole = solve(block, depth);
    if (whole)
        return whole;
    const b = trim(block);
    if (!b || depth >= 3)
        return [];
    for (const axis of h(b) >= w(b)
        ? ['y', 'x']
        : ['x', 'y']) {
        const cuts = gaps(b, axis).sort((a, c) => a[0] - c[0]);
        if (!cuts.length)
            continue;
        const pieces = [];
        let start = axis === 'y' ? b.y0 : b.x0;
        for (const [g0, g1] of cuts) {
            pieces.push(axis === 'y'
                ? { ...b, y0: start, y1: g0 }
                : { ...b, x0: start, x1: g0 });
            start = g1;
        }
        pieces.push(axis === 'y' ? { ...b, y0: start } : { ...b, x0: start });
        const out = pieces.flatMap((p) => collect(p, solve, trim, gaps, depth + 1));
        if (out.length)
            return out;
    }
    return [];
}
const WHITE_MARGIN = 8;
const MIN_WHITE = 200;
const ANALYSE_WIDTH = 1000;
function pageWhite(px, width, height, stride = width) {
    const hist = new Uint32Array(256);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            hist[px[y * stride + x]]++;
    let left = Math.ceil(width * height * 0.01);
    for (let v = 255; v >= 0; v--) {
        left -= hist[v];
        if (left <= 0)
            return v;
    }
    return 0;
}
async function chequeRegions(file, mimeType) {
    try {
        const mupdf = await import('mupdf');
        const doc = mupdf.Document.openDocument(file, mimeType);
        try {
            const page = doc.loadPage(0);
            try {
                const [x0, , x1] = page.getBounds();
                const scale = Math.min(1, ANALYSE_WIDTH / Math.max(1, x1 - x0)) || 1;
                const pix = page.toPixmap([scale, 0, 0, scale, 0, 0], mupdf.ColorSpace.DeviceGray, false);
                try {
                    const width = pix.getWidth();
                    const height = pix.getHeight();
                    const stride = pix.getStride();
                    const px = pix.getPixels();
                    const white = pageWhite(px, width, height, stride);
                    if (white < MIN_WHITE)
                        return [];
                    const ink = new Uint8Array(width * height);
                    for (let y = 0; y < height; y++) {
                        for (let x = 0; x < width; x++) {
                            ink[y * width + x] =
                                px[y * stride + x] < white - WHITE_MARGIN ? 1 : 0;
                        }
                    }
                    return splitRegions(ink, width, height).map((r) => ({
                        x0: r.x0 / width,
                        y0: r.y0 / height,
                        x1: r.x1 / width,
                        y1: r.y1 / height,
                    }));
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
    catch {
        return [];
    }
}
//# sourceMappingURL=cheque-split.js.map