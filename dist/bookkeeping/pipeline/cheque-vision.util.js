"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_AREA_SHARE = exports.MIN_AREA_SHARE = exports.MAX_ASPECT = exports.MIN_ASPECT = void 0;
exports.chequeShaped = chequeShaped;
exports.chequeRects = chequeRects;
exports.inReadingOrder = inReadingOrder;
exports.sameRow = sameRow;
exports.pairBacks = pairBacks;
exports.cutBox = cutBox;
exports.backColumn = backColumn;
exports.MIN_ASPECT = 1.5;
exports.MAX_ASPECT = 3.8;
exports.MIN_AREA_SHARE = 0.025;
exports.MAX_AREA_SHARE = 0.92;
const SAME_FRAME = 0.7;
const INSIDE = 0.85;
const areaOf = (r) => Math.max(0, r.w) * Math.max(0, r.h);
function overlap(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
}
const inside = (inner, outer) => overlap(inner, outer) >= areaOf(inner) * INSIDE;
function chequeShaped(r, width, height) {
    if (r.h <= 0)
        return false;
    const aspect = r.w / r.h;
    const share = areaOf(r) / (width * height);
    return (aspect >= exports.MIN_ASPECT &&
        aspect <= exports.MAX_ASPECT &&
        share >= exports.MIN_AREA_SHARE &&
        share <= exports.MAX_AREA_SHARE);
}
function chequeRects(rects, width, height) {
    const shaped = rects
        .filter((r) => chequeShaped(r, width, height))
        .sort((a, b) => areaOf(b) - areaOf(a));
    const frames = [];
    for (const r of shaped) {
        const same = frames.some((f) => inside(r, f) && areaOf(r) >= areaOf(f) * SAME_FRAME);
        if (!same)
            frames.push(r);
    }
    return frames.filter((f) => {
        const within = frames.filter((g) => g !== f && inside(g, f));
        if (within.length >= 2)
            return false;
        const holders = frames.filter((g) => g !== f && inside(f, g));
        return !holders.some((g) => frames.filter((k) => k !== g && inside(k, g)).length < 2);
    });
}
function inReadingOrder(rects) {
    const byTop = [...rects].sort((a, b) => a.y - b.y);
    const rows = [];
    for (const r of byTop) {
        const row = rows[rows.length - 1];
        if (row && r.y < row[0].y + row[0].h / 2)
            row.push(r);
        else
            rows.push([r]);
    }
    return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}
function sameRow(a, b) {
    const shared = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return shared >= 0.6 * Math.min(a.h, b.h);
}
function pairBacks(ordered, isBack) {
    const out = [];
    ordered.forEach((r, i) => {
        const last = out[out.length - 1];
        const beside = !!last && sameRow(last.front, r);
        if (isBack[i] && beside && !last.back)
            last.back = r;
        else
            out.push({ front: r, back: null });
    });
    return out;
}
function cutBox(cheque, all, width, height, captionShare = 0.2) {
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
function backColumn(ordered, isBack, hasNumber) {
    const rows = [];
    ordered.forEach((r, i) => {
        const row = rows[rows.length - 1];
        if (row && sameRow(ordered[row[0]], r))
            row.push(i);
        else
            rows.push([i]);
    });
    const right = rows.map((row) => row[1]);
    const grid = rows.length > 0 && rows.every((row) => row.length === 2);
    if (grid &&
        right.some((i) => isBack[i]) &&
        !right.some((i) => hasNumber[i])) {
        return ordered.map((_, i) => right.includes(i));
    }
    return [...isBack];
}
//# sourceMappingURL=cheque-vision.util.js.map