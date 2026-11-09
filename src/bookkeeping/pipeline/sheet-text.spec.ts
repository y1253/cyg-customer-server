import ExcelJS from 'exceljs';
import {
  MAX_ROWS_PER_SHEET,
  parseCsv,
  sheetText,
  sheetsToText,
} from './sheet-text';

describe('parseCsv', () => {
  it('reads quoted cells, doubled quotes and line breaks inside quotes', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'two\nlines', '3'],
    ]);
  });

  it('uses ; when the file does (Excel in French)', () => {
    expect(parseCsv('Date;Montant\n2026-03-02;12,50')).toEqual([
      ['Date', 'Montant'],
      ['2026-03-02', '12,50'],
    ]);
  });

  it('drops a byte-order mark', () => {
    expect(parseCsv('\uFEFFx,y')).toEqual([['x', 'y']]);
  });
});

describe('sheetsToText', () => {
  it('one block per sheet, tab-separated, empty rows and trailing cells dropped', () => {
    expect(
      sheetsToText([
        {
          name: 'Bills',
          rows: [['Vendor', 'Amount', ''], [], ['Hydro', '312.40']],
        },
        { name: 'Empty', rows: [[''], []] },
      ]),
    ).toBe('Sheet "Bills" (2 rows):\nVendor\tAmount\nHydro\t312.40');
  });

  it('says how many rows were left out', () => {
    const rows = Array.from({ length: MAX_ROWS_PER_SHEET + 3 }, (_, i) => [
      String(i),
    ]);
    const text = sheetsToText([{ name: 'Big', rows }]);
    expect(text).toContain('… 3 more rows');
  });
});

describe('sheetText', () => {
  it('reads an .xlsx made by exceljs', async () => {
    const book = new ExcelJS.Workbook();
    const ws = book.addWorksheet('March');
    ws.addRow(['Date', 'Vendor', 'Amount']);
    ws.addRow(['2026-03-02', 'Rona', 450]);
    const file = Buffer.from(await book.xlsx.writeBuffer());
    const text = await sheetText(
      file,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(text).toBe(
      'Sheet "March" (2 rows):\nDate\tVendor\tAmount\n2026-03-02\tRona\t450',
    );
  });

  it('reads a CSV', async () => {
    expect(await sheetText(Buffer.from('a,b\n1,2'), 'text/csv')).toBe(
      'Sheet "CSV" (2 rows):\na\tb\n1\t2',
    );
  });

  it('is null for a file it cannot open', async () => {
    expect(
      await sheetText(
        Buffer.from('not a zip'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBeNull();
  });
});
