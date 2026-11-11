import type { Prepared } from './document-pipeline';
import { pageTextHint, TOOL_TEXT_CHARS, toolResultsHint } from './tool-results';

const prepared = (over: Partial<Prepared> = {}): Prepared => ({
  source: 'OCR',
  ok: true,
  text: 'WALMART\nTOTAL 26.85',
  confidence: 0.912,
  reason: null,
  cheque: false,
  chequeNumber: null,
  ...over,
});

describe('toolResultsHint', () => {
  it('says nothing when no tool found anything', () => {
    expect(toolResultsHint(null)).toBe('');
    expect(toolResultsHint(null, [])).toBe('');
  });

  it('gives what read the file, how surely, and its text — the file wins', () => {
    const hint = toolResultsHint(prepared());
    expect(hint).toContain('TOOL RESULTS');
    expect(hint).toContain('The FILE always wins');
    expect(hint).toContain('Read by OCR, overall confidence 91%.');
    expect(hint).toContain('"""\nWALMART\nTOTAL 26.85\n"""');
  });

  it('says why the tool was unsure, and the cheque number it read', () => {
    const hint = toolResultsHint(
      prepared({
        ok: false,
        reason: 'cheque handwriting (Tesseract)',
        cheque: true,
        chequeNumber: '001042',
      }),
    );
    expect(hint).toContain('(it was unsure: cheque handwriting (Tesseract))');
    expect(hint).toContain('MICR line: 001042.');
  });

  it("names the PDF's text layer without a confidence", () => {
    const hint = toolResultsHint(
      prepared({ source: 'PDF_TEXT', confidence: null }),
    );
    expect(hint).toContain("Read by the PDF's own text layer.");
  });

  it('lists the cheque regions, a back and each number, and leaves the decision to the model', () => {
    const hint = toolResultsHint(null, [
      {
        box: { x0: 0, y0: 0, x1: 0.4812, y1: 1 },
        chequeNumber: '1042',
        back: false,
      },
      {
        box: { x0: 0.52, y0: 0, x1: 1, y1: 1 },
        chequeNumber: null,
        back: true,
      },
    ]);
    expect(hint).toContain('2 cheque-shaped regions');
    expect(hint).toContain('Decide yourself how many documents there are');
    expect(hint).toContain('1. (0, 0, 0.48, 1), cheque number 1042');
    expect(hint).toContain(
      '2. (0.52, 0, 1, 1) reads like the BACK of a cheque',
    );
  });

  it('caps the text it passes on', () => {
    const hint = toolResultsHint(prepared({ text: 'x'.repeat(20_000) }));
    expect(hint.match(/x{100,}/)?.[0].length).toBe(TOOL_TEXT_CHARS);
  });
});

describe('pageTextHint', () => {
  it("gives a statement page's text layer as tool results", () => {
    const hint = pageTextHint('Sep 02  CHEQUE 1042  450.00');
    expect(hint).toContain('TOOL RESULTS');
    expect(hint).toContain('"""\nSep 02  CHEQUE 1042  450.00\n"""');
  });
});
