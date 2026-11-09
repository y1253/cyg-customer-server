// `pdfPageTexts` (mupdf) is checked by `scripts/bookkeeping-probe.ts --text-pipeline`.
import {
  layoutRows,
  pdfTextQuality,
  piecesOf,
  type TextPiece,
} from './pdf-text';

const piece = (text: string, x: number, y: number, size = 10): TextPiece => ({
  text,
  x,
  y,
  width: text.length * size * 0.5,
  size,
});

describe('layoutRows — the page as printed, columns kept', () => {
  it('puts pieces on one baseline into one row, each at its column', () => {
    const rows = layoutRows([
      piece('Date', 50, 100),
      piece('Withdrawals', 300, 100),
      piece('Deposits', 400, 100),
      piece('Mar 03', 50, 115),
      piece('450.00', 300, 115.5),
      piece('Mar 05', 50, 130),
      piece('200.00', 400, 130),
    ]).split('\n');
    expect(rows).toHaveLength(3);
    // The withdrawal and the deposit stay under their own headers.
    expect(rows[1].indexOf('450.00')).toBe(rows[0].indexOf('Withdrawals'));
    expect(rows[2].indexOf('200.00')).toBe(rows[0].indexOf('Deposits'));
  });

  it('two pieces that would overlap keep a space between them', () => {
    expect(layoutRows([piece('CHEQUE', 50, 10), piece('1042', 52, 10)])).toBe(
      'CHEQUE 1042',
    );
  });

  it('keeps the spaces inside one printed string (its columns)', () => {
    expect(layoutRows([piece('TOTAL        211.58', 50, 10)])).toBe(
      'TOTAL        211.58',
    );
  });

  it('an empty page is empty', () => {
    expect(layoutRows([])).toBe('');
  });
});

describe('pdfTextQuality', () => {
  it('a real text layer passes', () => {
    expect(
      pdfTextQuality(
        'TD Canada Trust  Business Chequing  Statement period Mar 1 - Mar 31 2026\n' +
          'Mar 03  CHEQUE 1042   450.00   1,550.00',
      ),
    ).toEqual({ ok: true, reason: null });
  });

  it('a scan (no text) and broken fonts do not', () => {
    expect(pdfTextQuality('Page 1')).toMatchObject({ ok: false });
    expect(
      pdfTextQuality(
        `${'(cid:12)(cid:40)(cid:3) '.repeat(20)}Statement 2026 balance`,
      ),
    ).toMatchObject({ ok: false, reason: 'fonts without a text map' });
  });
});

describe('piecesOf', () => {
  it('skips vertical text and non-text blocks', () => {
    const json = JSON.stringify({
      blocks: [
        { type: 'image', lines: [] },
        {
          type: 'text',
          lines: [
            { wmode: 0, x: 10, y: 20, text: 'A', font: { size: 9 } },
            { wmode: 1, x: 10, y: 40, text: 'B', font: { size: 9 } },
          ],
        },
      ],
    });
    expect(piecesOf(json)).toEqual([
      { text: 'A', x: 10, y: 20, width: 0, size: 9 },
    ]);
  });
});
