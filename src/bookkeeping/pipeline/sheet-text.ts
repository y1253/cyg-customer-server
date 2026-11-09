import ExcelJS from 'exceljs';

/**
 * step2 (2026-11-08): a spreadsheet a customer sends (.xlsx, .csv) as text the AI can read —
 * one block per sheet, one tab-separated line per row. The model cannot open a spreadsheet
 * at all, so this IS the reading; a file it cannot open fails with a sentence the customer
 * can act on. Old binary .xls is refused at upload ("save it as .xlsx").
 */

/** Per sheet; past it the text says how many rows were left out. */
export const MAX_ROWS_PER_SHEET = 500;
/** The whole text handed to the AI. */
export const MAX_SHEET_CHARS = 40_000;

/** One CSV line → its cells (RFC 4180: quoted cells, "" = a quote, commas or semicolons). */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '');
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  // Excel in French writes ; between cells.
  const sep =
    (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length
      ? ';'
      : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Sheets → the text block the AI reads. Pure. Empty rows / trailing empty cells dropped. */
export function sheetsToText(
  sheets: ReadonlyArray<{ name: string; rows: string[][] }>,
): string {
  const parts: string[] = [];
  for (const s of sheets) {
    const rows = s.rows
      .map((r) => {
        const cells = r.map((c) => c.replace(/[\t\r\n]+/g, ' ').trim());
        while (cells.length && !cells[cells.length - 1]) cells.pop();
        return cells;
      })
      .filter((r) => r.length);
    if (!rows.length) continue;
    const shown = rows.slice(0, MAX_ROWS_PER_SHEET).map((r) => r.join('\t'));
    if (rows.length > MAX_ROWS_PER_SHEET)
      shown.push(`… ${rows.length - MAX_ROWS_PER_SHEET} more rows`);
    parts.push(`Sheet "${s.name}" (${rows.length} rows):\n${shown.join('\n')}`);
  }
  const text = parts.join('\n\n');
  return text.length > MAX_SHEET_CHARS
    ? `${text.slice(0, MAX_SHEET_CHARS)}\n… (cut here)`
    : text;
}

/** The spreadsheet's text, or null when it cannot be opened. */
export async function sheetText(
  file: Buffer,
  mime: string,
): Promise<string | null> {
  try {
    if (mime === 'text/csv') {
      return sheetsToText([
        { name: 'CSV', rows: parseCsv(file.toString('utf8')) },
      ]);
    }
    const book = new ExcelJS.Workbook();
    // exceljs types its Buffer as the old global one.
    await book.xlsx.load(file as unknown as ExcelJS.Buffer);
    const sheets = book.worksheets.map((ws) => {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (r) => {
        const cells: string[] = [];
        r.eachCell({ includeEmpty: true }, (cell, col) => {
          cells[col - 1] = cell.text ?? '';
        });
        rows.push(Array.from(cells, (c) => c ?? ''));
      });
      return { name: ws.name, rows };
    });
    return sheetsToText(sheets);
  } catch {
    return null;
  }
}
