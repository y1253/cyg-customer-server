"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHEQUE_MIN_WIDTH_PX = exports.ONE_CHEQUE_HINT = void 0;
exports.findCheques = findCheques;
exports.readAlone = readAlone;
exports.readChequesAlone = readChequesAlone;
const cheque_split_1 = require("./cheque-split");
const crop_1 = require("./crop");
const cheque_vision_1 = require("./pipeline/cheque-vision");
const cheque_vision_util_1 = require("./pipeline/cheque-vision.util");
const pdf_images_1 = require("./pdf-images");
const ocr_util_1 = require("./pipeline/ocr.util");
function inset(b, share) {
    const dx = (b.x1 - b.x0) * share;
    const dy = (b.y1 - b.y0) * share;
    return { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 - dx, y1: b.y1 - dy };
}
async function findCheques(file, mime, pipeline) {
    if (!pipeline.enabled())
        return null;
    const scan = await (0, cheque_vision_1.scanCheques)(file, mime);
    const rects = scan && scan.rects.length >= 2 ? scan.rects : [];
    const asBox = (r) => ({
        x0: r.x / scan.width,
        y0: r.y / scan.height,
        x1: (r.x + r.w) / scan.width,
        y1: (r.y + r.h) / scan.height,
    });
    const boxes = rects.length
        ? rects.map(asBox)
        : await (0, cheque_split_1.chequeRegions)(file, mime);
    if (boxes.length < 2)
        return null;
    const by = rects.length ? 'opencv' : 'xy-cut';
    const regions = boxes.map((box) => ({
        box,
        chequeNumber: null,
        back: false,
    }));
    let crops;
    try {
        crops = await (0, crop_1.cropImage)(file, mime, boxes.map((b) => inset(b, 0.03)), exports.CHEQUE_MIN_WIDTH_PX);
    }
    catch {
        return { regions, cheques: [], by };
    }
    for (let i = 0; i < crops.length; i++) {
        const ocr = await pipeline.readImage(crops[i]);
        if (!ocr)
            continue;
        regions[i].back = (0, ocr_util_1.looksLikeChequeBack)(ocr);
        regions[i].chequeNumber =
            !regions[i].back && (0, ocr_util_1.looksLikeChequeText)(ocr)
                ? (0, ocr_util_1.chequeNumberFromOcr)(ocr)
                : null;
    }
    if (!rects.length)
        return { regions, cheques: [], by };
    const captions = await captionsOver(file, mime, rects, scan, pipeline);
    captions.forEach((c, i) => {
        if (c?.number && !regions[i].back)
            regions[i].chequeNumber ??= c.number;
    });
    rects.forEach((r, i) => {
        const prev = i > 0 ? captions[i - 1] : null;
        const mine = captions[i];
        if (i > 0 &&
            (0, cheque_vision_util_1.sameRow)(rects[i - 1], r) &&
            prev?.number &&
            prev.amount !== null &&
            mine?.number === prev.number &&
            mine.amount === null) {
            regions[i].back = true;
            regions[i].chequeNumber = null;
        }
    });
    const backs = (0, cheque_vision_util_1.backColumn)(rects, regions.map((r) => r.back), regions.map((r) => !!r.chequeNumber));
    backs.forEach((b, i) => (regions[i].back = b));
    const cheques = rects.length
        ? (0, cheque_vision_util_1.pairBacks)(rects, backs).map((c) => ({
            box: (0, cheque_vision_util_1.cutBox)(c, rects, scan.width, scan.height),
            number: regions[rects.indexOf(c.front)].chequeNumber,
        }))
        : [];
    return { regions, cheques, by };
}
function readAlone(found) {
    return (found.cheques.length >= 2 ||
        (found.cheques.length === 1 && found.regions.some((r) => r.back)));
}
async function captionsOver(file, mime, rects, scan, pipeline) {
    const bands = rects.map((r) => ({
        x0: r.x / scan.width,
        y0: Math.max(0, r.y - r.h * 0.18) / scan.height,
        x1: (r.x + r.w) / scan.width,
        y1: r.y / scan.height,
    }));
    const out = rects.map(() => null);
    if (bands.every((b) => b.y1 - b.y0 <= 0))
        return out;
    let crops;
    try {
        crops = await (0, crop_1.cropImage)(file, mime, bands, exports.CHEQUE_MIN_WIDTH_PX);
    }
    catch {
        return out;
    }
    for (let i = 0; i < crops.length; i++) {
        if (bands[i].y1 - bands[i].y0 <= 0)
            continue;
        const ocr = await pipeline.readImage(crops[i]);
        const caption = ocr ? (0, pdf_images_1.parseCaption)(ocr.text) : null;
        out[i] = caption?.number ? caption : null;
    }
    return out;
}
exports.ONE_CHEQUE_HINT = '\n\nThis image is ONE cheque, cut out of a bigger image by our tools (its back may be ' +
    'beside it — part of the same cheque, never a second document). Return exactly one ' +
    'document. Read the payee, the amount, the date and the memo from THIS cheque only. A ' +
    'caption printed over it by the bank ("CHEQUE # 00021 $2,318.08") is its number and ' +
    "amount. The date is the one written on the cheque's front, never a deposit date stamped " +
    'on its back. A payee or date you cannot read is null — never a guess.';
exports.CHEQUE_MIN_WIDTH_PX = 1400;
async function readChequesAlone(input) {
    const { cheques, only = null } = input;
    let crops;
    try {
        crops = await (0, crop_1.cropImage)(input.file, input.mime, cheques.map((c) => c.box), exports.CHEQUE_MIN_WIDTH_PX);
    }
    catch {
        return null;
    }
    const readings = new Array(cheques.length);
    for (let i = 0; i < cheques.length; i++) {
        if (only !== null && i !== only)
            continue;
        const prepared = (await input.pipeline?.prepare(crops[i], 'image/png', 'image')) ?? null;
        const [first] = await input.extractor.read(crops[i], `${input.filename.slice(0, 200)} (cheque ${i + 1} of ${cheques.length})`, 'image/png', 'image', input.today, input.message, input.hints + exports.ONE_CHEQUE_HINT, prepared, []);
        if (!first)
            return null;
        const reading = { ...first, box: cheques[i].box };
        readings[i] = input.withOcr ? input.withOcr(reading, prepared) : reading;
    }
    return readings;
}
//# sourceMappingURL=cheque-reading.js.map