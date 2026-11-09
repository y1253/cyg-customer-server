"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_TEXT_CONFIDENCE = exports.MIN_LINE_CONFIDENCE = void 0;
exports.micrLine = micrLine;
exports.looksLikeChequeText = looksLikeChequeText;
exports.chequeNumberFromOcr = chequeNumberFromOcr;
exports.looksLikeChequeBack = looksLikeChequeBack;
exports.sideBySide = sideBySide;
exports.severalCheques = severalCheques;
exports.ocrGate = ocrGate;
exports.ocrText = ocrText;
exports.MIN_LINE_CONFIDENCE = 0.85;
exports.MIN_TEXT_CONFIDENCE = 0.88;
const MIN_CHARS = 15;
const MONEY = /\d[\d,\s]*[.,]\d{2}(?!\d)/;
const CHEQUE_WORDS = /(?<![\p{L}\p{N}])(pay\s+to\s+the\s+order|order\s+of|payez\s+[àa]|à\s+l['’]ordre|pay\s*\/\s*payez|dollars|cheque|chèque|check\s*no|memo|mémo|non[-\s]?négociable|void\s+after)(?![\p{L}\p{N}])/iu;
const MICR_SYMBOLS = /[⑆⑇⑈⑉□☐■▯|]/;
const chars = (s) => s.replace(/[^\p{L}\p{N}]/gu, '').length;
function micrLine(r) {
    const height = r.height;
    const bottom = r.lines.filter((l) => l.boxes.some((b) => b.y >= height * 0.65));
    for (const l of bottom.reverse()) {
        const digits = l.text.replace(/\D/g, '').length;
        const groups = (l.text.match(/\d{3,}/g) ?? []).length;
        if (digits >= 12 && (MICR_SYMBOLS.test(l.text) || groups >= 3))
            return l;
    }
    return null;
}
function looksLikeChequeText(r) {
    return CHEQUE_WORDS.test(r.text) || micrLine(r) !== null;
}
function chequeNumberFromOcr(r) {
    const { width, height } = r;
    const micr = micrLine(r);
    const micrGroups = (micr?.text.match(/\d+/g) ?? []).map((g) => g.replace(/^0+/, ''));
    const topRight = [];
    for (const line of r.lines) {
        for (const b of line.boxes) {
            if (b.y > height * 0.4 || b.x + b.width < width * 0.55)
                continue;
            if (b.confidence < exports.MIN_LINE_CONFIDENCE)
                continue;
            if (MONEY.test(b.text) || /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(b.text))
                continue;
            for (const n of b.text.match(/\b\d{3,8}\b/g) ?? [])
                topRight.push(n);
        }
    }
    const confirmed = topRight.find((n) => micrGroups.includes(n.replace(/^0+/, '')));
    if (confirmed)
        return confirmed;
    if (topRight.length === 1)
        return topRight[0];
    const short = (micr?.text.match(/\d+/g) ?? []).filter((g) => g.length >= 3 && g.length <= 6 && g.replace(/^0+/, '').length >= 1);
    return micr && micr.confidence >= exports.MIN_LINE_CONFIDENCE && short.length === 1
        ? short[0]
        : null;
}
const BACK_WORDS = /(?<![\p{L}\p{N}])(endorse|for\s+deposit|deposit\s+only|pour\s+d[ée]p[ôo]t|do\s+not\s+write|ne\s+pas\s+[ée]crire|sign\s+here)(?![\p{L}\p{N}])/iu;
function looksLikeChequeBack(r) {
    if (looksLikeChequeText(r) || MONEY.test(r.text))
        return false;
    return BACK_WORDS.test(r.text) || chars(r.text) < 40;
}
function sideBySide(r) {
    const width = r.width;
    let wide = 0;
    for (const l of r.lines) {
        const boxes = [...l.boxes].sort((a, b) => a.x - b.x);
        for (let i = 1; i < boxes.length; i++) {
            const gap = boxes[i].x - (boxes[i - 1].x + boxes[i - 1].width);
            if (gap > width * 0.25) {
                wide++;
                break;
            }
        }
    }
    return wide >= 3;
}
const PAYEE_ANCHOR = /(?<![\p{L}\p{N}])(pay\s+to\s+the\s+order\s+of|payez\s+[àa]\s+l['’]ordre\s+de|à\s+l['’]ordre\s+de)(?![\p{L}\p{N}])/giu;
function severalCheques(r) {
    const anchors = (r.text.match(PAYEE_ANCHOR) ?? []).length;
    const micr = r.lines.filter((l) => {
        const digits = l.text.replace(/\D/g, '').length;
        return (digits >= 12 &&
            (MICR_SYMBOLS.test(l.text) || (l.text.match(/\d{3,}/g) ?? []).length >= 3));
    }).length;
    return anchors >= 2 || micr >= 2;
}
function ocrGate(r) {
    if (!r)
        return { ok: false, cheque: false, reason: 'no OCR' };
    const cheque = looksLikeChequeText(r);
    if (chars(r.text) < MIN_CHARS)
        return { ok: false, cheque, reason: 'too little text' };
    if (r.confidence < exports.MIN_TEXT_CONFIDENCE)
        return {
            ok: false,
            cheque,
            reason: `low confidence ${r.confidence.toFixed(2)}`,
        };
    if (cheque && r.engine === 'tesseract')
        return { ok: false, cheque, reason: 'cheque handwriting (Tesseract)' };
    if (sideBySide(r))
        return { ok: false, cheque, reason: 'documents side by side' };
    if (cheque && severalCheques(r))
        return { ok: false, cheque, reason: 'several cheques in one image' };
    if (cheque) {
        if (!chequeNumberFromOcr(r))
            return { ok: false, cheque, reason: 'cheque number not read' };
        const amount = r.lines.some((l) => MONEY.test(l.text) && l.confidence >= exports.MIN_LINE_CONFIDENCE);
        if (!amount)
            return { ok: false, cheque, reason: 'cheque amount not read surely' };
        const payee = r.lines.find((l) => /(?<![\p{L}\p{N}])(order\s+of|payez|l['’]ordre|pay)(?![\p{L}\p{N}])/iu.test(l.text));
        const written = payee?.text
            .replace(/.*(?<![\p{L}\p{N}])(order\s+of|payez\s+[àa]|l['’]ordre\s+de|pay)(?![\p{L}\p{N}])/iu, '')
            .trim();
        if (!payee || !written || chars(written) < 2)
            return { ok: false, cheque, reason: 'payee not read' };
        if (payee.confidence < exports.MIN_LINE_CONFIDENCE)
            return { ok: false, cheque, reason: 'payee not read surely' };
    }
    return { ok: true, cheque };
}
function ocrText(r) {
    return r.lines
        .map((l) => l.confidence < exports.MIN_LINE_CONFIDENCE
        ? `${l.text}   [unsure ${Math.round(l.confidence * 100)}%]`
        : l.text)
        .join('\n');
}
//# sourceMappingURL=ocr.util.js.map