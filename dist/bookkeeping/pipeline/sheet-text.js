"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SHEET_CHARS = exports.MAX_ROWS_PER_SHEET = void 0;
exports.parseCsv = parseCsv;
exports.sheetsToText = sheetsToText;
exports.sheetText = sheetText;
const exceljs_1 = __importDefault(require("exceljs"));
exports.MAX_ROWS_PER_SHEET = 500;
exports.MAX_SHEET_CHARS = 40_000;
function parseCsv(text) {
    const body = text.replace(/^\uFEFF/, '');
    const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
    const sep = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length
        ? ';'
        : ',';
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (quoted) {
            if (c === '"' && body[i + 1] === '"') {
                cell += '"';
                i++;
            }
            else if (c === '"')
                quoted = false;
            else
                cell += c;
        }
        else if (c === '"' && !cell)
            quoted = true;
        else if (c === sep) {
            row.push(cell);
            cell = '';
        }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && body[i + 1] === '\n')
                i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        }
        else
            cell += c;
    }
    if (cell || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}
function sheetsToText(sheets) {
    const parts = [];
    for (const s of sheets) {
        const rows = s.rows
            .map((r) => {
            const cells = r.map((c) => c.replace(/[\t\r\n]+/g, ' ').trim());
            while (cells.length && !cells[cells.length - 1])
                cells.pop();
            return cells;
        })
            .filter((r) => r.length);
        if (!rows.length)
            continue;
        const shown = rows.slice(0, exports.MAX_ROWS_PER_SHEET).map((r) => r.join('\t'));
        if (rows.length > exports.MAX_ROWS_PER_SHEET)
            shown.push(`… ${rows.length - exports.MAX_ROWS_PER_SHEET} more rows`);
        parts.push(`Sheet "${s.name}" (${rows.length} rows):\n${shown.join('\n')}`);
    }
    const text = parts.join('\n\n');
    return text.length > exports.MAX_SHEET_CHARS
        ? `${text.slice(0, exports.MAX_SHEET_CHARS)}\n… (cut here)`
        : text;
}
async function sheetText(file, mime) {
    try {
        if (mime === 'text/csv') {
            return sheetsToText([
                { name: 'CSV', rows: parseCsv(file.toString('utf8')) },
            ]);
        }
        const book = new exceljs_1.default.Workbook();
        await book.xlsx.load(file);
        const sheets = book.worksheets.map((ws) => {
            const rows = [];
            ws.eachRow({ includeEmpty: false }, (r) => {
                const cells = [];
                r.eachCell({ includeEmpty: true }, (cell, col) => {
                    cells[col - 1] = cell.text ?? '';
                });
                rows.push(Array.from(cells, (c) => c ?? ''));
            });
            return { name: ws.name, rows };
        });
        return sheetsToText(sheets);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=sheet-text.js.map