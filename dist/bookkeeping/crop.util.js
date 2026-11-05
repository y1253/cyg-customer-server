"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cropPlan = cropPlan;
exports.toPageBox = toPageBox;
const MAX_OVERLAP = 0.5;
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
function overlapShare(a, b) {
    const inter = area({
        x0: Math.max(a.x0, b.x0),
        y0: Math.max(a.y0, b.y0),
        x1: Math.min(a.x1, b.x1),
        y1: Math.min(a.y1, b.y1),
    });
    const smaller = Math.min(area(a), area(b));
    return smaller > 0 ? inter / smaller : 1;
}
function cropPlan(boxes) {
    if (boxes.length < 2)
        return null;
    if (boxes.some((b) => !b))
        return null;
    const list = boxes;
    if (list.some((b) => area(b) > 0.9))
        return null;
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            if (overlapShare(list[i], list[j]) > MAX_OVERLAP)
                return null;
        }
    }
    return list;
}
function toPageBox(box, width, height, margin = 0.01) {
    const clamp = (v) => Math.min(1, Math.max(0, v));
    return [
        clamp(box.x0 - margin) * width,
        clamp(box.y0 - margin) * height,
        clamp(box.x1 + margin) * width,
        clamp(box.y1 + margin) * height,
    ];
}
//# sourceMappingURL=crop.util.js.map