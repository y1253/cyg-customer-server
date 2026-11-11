"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_TEXT_CHARS = void 0;
exports.toolResultsHint = toolResultsHint;
exports.pageTextHint = pageTextHint;
exports.TOOL_TEXT_CHARS = 8000;
const TOOLS_HEADER = 'TOOL RESULTS: our own tools read this file before you. They are a help, not the ' +
    'answer: use them to check every number, name and date you read, and look again ' +
    'wherever they disagree with what you see. The FILE always wins. Text the tools could ' +
    'not read (handwriting, other alphabets such as Yiddish or Hebrew, a photo) you read ' +
    'yourself from the file.';
const SOURCE_LABEL = {
    OCR: 'OCR',
    PDF_TEXT: "the PDF's own text layer",
    SHEET: "the spreadsheet's cells",
};
const round = (n) => Math.round(n * 100) / 100;
function toolResultsHint(prepared, regions = []) {
    const lines = [];
    if (prepared) {
        const sure = prepared.confidence != null
            ? `, overall confidence ${Math.round(prepared.confidence * 100)}%`
            : '';
        const doubt = prepared.reason ? ` (it was unsure: ${prepared.reason})` : '';
        lines.push(`- Read by ${SOURCE_LABEL[prepared.source]}${sure}${doubt}.`);
        if (prepared.chequeNumber) {
            lines.push(`- Cheque number OCR read off the printed number / MICR line: ${prepared.chequeNumber}.`);
        }
    }
    if (regions.length) {
        lines.push(`- ${regions.length} cheque-shaped regions found in the image (x0, y0, x1, y1 as fractions ` +
            'of its width and height). Decide yourself how many documents there are and where ' +
            'each one is:', ...regions.map((r, i) => `  ${i + 1}. (${round(r.box.x0)}, ${round(r.box.y0)}, ${round(r.box.x1)}, ${round(r.box.y1)})` +
            (r.back
                ? ' reads like the BACK of a cheque'
                : r.chequeNumber
                    ? `, cheque number ${r.chequeNumber}`
                    : '')));
    }
    const text = prepared?.text.trim();
    if (text) {
        lines.push('- Text read off it (laid out as printed; a line marked [unsure NN%] was a weak read):', `"""\n${text.slice(0, exports.TOOL_TEXT_CHARS)}\n"""`);
    }
    return lines.length ? `\n\n${TOOLS_HEADER}\n${lines.join('\n')}` : '';
}
function pageTextHint(text) {
    return (`${TOOLS_HEADER}\n- This page's text layer (every line as printed, columns kept with ` +
        `spaces):\n"""\n${text.slice(0, exports.TOOL_TEXT_CHARS * 2)}\n"""\n` +
        `- The text cannot show which lines are captions over cheque / deposit images, or which ` +
        `column an amount sits in — the page image decides both. A caption over an image is never a row.`);
}
//# sourceMappingURL=tool-results.js.map