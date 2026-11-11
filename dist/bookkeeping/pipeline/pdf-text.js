"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.layoutRows = layoutRows;
exports.pdfTextQuality = pdfTextQuality;
exports.pdfPageTexts = pdfPageTexts;
exports.piecesOf = piecesOf;
exports.printedBalanceLines = printedBalanceLines;
function layoutRows(pieces) {
    const list = pieces.filter((p) => p.text.trim());
    if (!list.length)
        return '';
    const sizes = list.map((p) => p.size).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)] || 10;
    const charW = Math.max(2, median * 0.5);
    const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const p of sorted) {
        const row = rows[rows.length - 1];
        if (row && Math.abs(row[0].y - p.y) <= Math.max(2, median * 0.4))
            row.push(p);
        else
            rows.push([p]);
    }
    const minX = Math.min(...list.map((p) => p.x));
    return rows
        .map((row) => {
        let line = '';
        for (const p of row.sort((a, b) => a.x - b.x)) {
            const col = Math.max(0, Math.round((p.x - minX) / charW));
            if (line.length && col <= line.length)
                line += ' ';
            else
                line = line.padEnd(col, ' ');
            line += p.text.replace(/[\t\r\n]/g, ' ').trim();
        }
        return line.trimEnd();
    })
        .join('\n');
}
const MIN_CHARS = 40;
function pdfTextQuality(text) {
    const solid = text.replace(/\s/g, '');
    const real = solid.replace(/[^\p{L}\p{N}]/gu, '').length;
    if (real < MIN_CHARS)
        return { ok: false, reason: 'no text layer' };
    const broken = (solid.match(/[�-]/g) ?? []).length +
        (text.match(/\(cid:\d+\)/g) ?? []).length * 6;
    if (broken / solid.length > 0.02)
        return { ok: false, reason: 'fonts without a text map' };
    if (real / solid.length < 0.45)
        return { ok: false, reason: 'mostly symbols' };
    return { ok: true, reason: null };
}
async function pdfPageTexts(pdf) {
    try {
        const mupdf = await import('mupdf');
        const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
        try {
            if (doc.needsPassword())
                return null;
            const out = [];
            const count = doc.countPages();
            for (let i = 0; i < count; i++) {
                const page = doc.loadPage(i);
                try {
                    const st = page.toStructuredText('preserve-whitespace');
                    try {
                        out.push(layoutRows(piecesOf(st.asJSON())));
                    }
                    finally {
                        st.destroy();
                    }
                }
                catch {
                    out.push('');
                }
                finally {
                    page.destroy();
                }
            }
            return out;
        }
        finally {
            doc.destroy();
        }
    }
    catch {
        return null;
    }
}
function piecesOf(json) {
    const parsed = JSON.parse(json);
    const out = [];
    for (const block of parsed.blocks ?? []) {
        if (block.type && block.type !== 'text')
            continue;
        for (const line of block.lines ?? []) {
            if (line.wmode === 1 || !line.text)
                continue;
            const box = line.bbox ?? { x: line.x ?? 0, y: line.y ?? 0, w: 0, h: 0 };
            out.push({
                text: line.text,
                x: line.x ?? box.x,
                y: line.y ?? box.y + box.h,
                width: box.w,
                size: line.font?.size ?? box.h ?? 10,
            });
        }
    }
    return out;
}
const OPENING_LABEL = /\b(previous (?:statement )?balance|opening balance|beginning balance|starting balance|balance forward)\b/i;
const CLOSING_LABEL = /\b(new balance|closing balance|ending balance)\b/i;
const AMOUNT = /\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/;
function printedBalanceLines(text) {
    const out = { opening: [], closing: [] };
    for (const line of text.split('\n')) {
        for (const [key, label] of [
            ['opening', OPENING_LABEL],
            ['closing', CLOSING_LABEL],
        ]) {
            const m = label.exec(line);
            if (!m)
                continue;
            const rest = line.slice(m.index);
            if (!AMOUNT.test(rest.slice(m[0].length)))
                continue;
            const shown = rest.replace(/\s+/g, ' ').trim().slice(0, 80);
            if (!out[key].includes(shown))
                out[key].push(shown);
        }
    }
    return out;
}
//# sourceMappingURL=pdf-text.js.map